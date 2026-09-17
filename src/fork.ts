// Fork a session: copy session + messages + parts (+todos) under a new id with
// parent_id pointing at the source. Optionally also fork the working directory
// as a git branch/worktree when the session's directory is a git repo.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { newId } from "./ids.js";
import {
  getSession,
  insertMessage,
  insertPart,
  insertSession,
  insertTodo,
  loadFullSession,
  resolveSessionId,
} from "./store.js";
import type { FullSession, SessionRow } from "./types.js";

export interface ForkOptions {
  /** fork title; defaults to "Fork of <title>" */
  title?: string;
  /** only copy history up to and including this message id */
  atMessage?: string;
  /** if the session directory is a git repo, create branch+worktree for the fork */
  withWorktree?: boolean;
  /** directory to place the worktree (default: <dir>.ocs-forks/<branch>) */
  worktreeDir?: string;
  now?: number;
}

export interface ForkResult {
  session: SessionRow;
  messagesCopied: number;
  partsCopied: number;
  /** set when withWorktree succeeded */
  worktree?: { directory: string; branch: string };
}

function isGitRepo(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function gitBranch(dir: string, name: string): void {
  execFileSync("git", ["-C", dir, "branch", name], { stdio: "pipe" });
}

function gitWorktreeAdd(dir: string, path: string, branch: string): void {
  execFileSync("git", ["-C", dir, "worktree", "add", path, branch], { stdio: "pipe" });
}

/** Copy a session's rows under new ids, preserving chronological order. */
export function copySessionRows(
  db: DatabaseSync,
  full: FullSession,
  newSessionId: string,
  patch: Partial<SessionRow>,
  now: number,
): { messagesCopied: number; partsCopied: number } {
  // Synthetic clock: 1 tick per row keeps generated ids strictly increasing.
  let tick = now;
  const next = () => tick++;

  const session: SessionRow = {
    ...full.session,
    ...patch,
    id: newSessionId,
    time_created: now,
    time_updated: now,
  };
  const messageIdMap = new Map<string, string>();
  let messagesCopied = 0;
  let partsCopied = 0;
  db.exec("BEGIN");
  try {
    insertSession(db, session);
    for (const { message, parts } of full.messages) {
      const newMessageId = newId("msg", next());
      messageIdMap.set(message.id, newMessageId);
      const data = JSON.parse(message.data) as Record<string, unknown>;
      if (typeof data.parentID === "string") {
        data.parentID = messageIdMap.get(data.parentID) ?? data.parentID;
      }
      insertMessage(db, {
        id: newMessageId,
        session_id: newSessionId,
        time_created: message.time_created,
        time_updated: message.time_updated,
        data: JSON.stringify(data),
      });
      messagesCopied++;
      for (const p of parts) {
        insertPart(db, {
          id: newId("prt", next()),
          message_id: newMessageId,
          session_id: newSessionId,
          time_created: p.time_created,
          time_updated: p.time_updated,
          data: p.data,
        });
        partsCopied++;
      }
    }
    for (const t of full.todos) insertTodo(db, { ...t, session_id: newSessionId });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { messagesCopied, partsCopied };
}

export function forkSession(db: DatabaseSync, idOrPrefix: string, opts: ForkOptions = {}): ForkResult {
  const sourceId = resolveSessionId(db, idOrPrefix);
  const full = loadFullSession(db, sourceId);
  const now = opts.now ?? Date.now();

  if (opts.atMessage) {
    const idx = full.messages.findIndex((m) => m.message.id === opts.atMessage);
    if (idx === -1) throw new Error(`message not found in session: ${opts.atMessage}`);
    full.messages = full.messages.slice(0, idx + 1);
  }

  const forkId = newId("ses", now);
  const patch: Partial<SessionRow> = {
    parent_id: sourceId,
    slug: `${full.session.slug}-fork`,
    title: opts.title ?? `Fork of ${full.session.title}`,
    share_url: null,
    time_archived: null,
  };

  let worktree: ForkResult["worktree"];
  if (opts.withWorktree) {
    const dir = full.session.directory;
    if (!existsSync(dir)) throw new Error(`session directory does not exist: ${dir}`);
    if (!isGitRepo(dir)) throw new Error(`session directory is not a git repo: ${dir}`);
    const branch = `ocs/${forkId.slice(4, 16)}`;
    const wtDir = opts.worktreeDir ?? join(dir + ".ocs-forks", branch.replace("/", "-"));
    gitBranch(dir, branch);
    gitWorktreeAdd(dir, wtDir, branch);
    patch.directory = wtDir;
    worktree = { directory: wtDir, branch };
  }

  const { messagesCopied, partsCopied } = copySessionRows(db, full, forkId, patch, now);
  const session = getSession(db, forkId)!;
  return worktree
    ? { session, messagesCopied, partsCopied, worktree }
    : { session, messagesCopied, partsCopied };
}
