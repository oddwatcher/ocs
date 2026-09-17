// Git-based sync: sessions are exported into a git repo (one directory per
// session) that can be pushed/pulled to GitHub or any remote.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { exportSession, importAllSessions, type ImportResult } from "./exporter.js";

export function defaultRepoPath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "ocs", "repo");
}

export function resolveRepoPath(explicit?: string): string {
  return explicit ?? process.env.OCS_REPO ?? defaultRepoPath();
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

/** Create the repo if missing. Returns true when it was just initialized. */
export function ensureRepo(repo: string): boolean {
  if (existsSync(join(repo, ".git"))) return false;
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  return true;
}

export function hasRemote(repo: string): boolean {
  return git(repo, ["remote"]) !== "";
}

function commitAll(repo: string, message: string): boolean {
  git(repo, ["add", "-A"]);
  const dirty = git(repo, ["status", "--porcelain"]) !== "";
  if (!dirty) return false;
  git(repo, ["-c", "user.name=ocs", "-c", "user.email=ocs@local", "commit", "-q", "-m", message]);
  return true;
}

export interface SyncPushResult {
  exported: string[];
  committed: boolean;
  pushed: boolean;
}

/** Export sessions into the repo, commit, and push when a remote exists. */
export function syncPush(
  db: DatabaseSync,
  repo: string,
  opts: { sessionIds?: string[]; push?: boolean; message?: string } = {},
): SyncPushResult {
  ensureRepo(repo);
  const ids =
    opts.sessionIds ??
    (db.prepare("SELECT id FROM session WHERE time_archived IS NULL").all() as unknown as Array<{ id: string }>).map(
      (r) => r.id,
    );
  const exported = ids.map((id) => exportSession(db, id, repo));
  const committed = commitAll(repo, opts.message ?? `ocs: export ${ids.length} session(s)`);
  let pushed = false;
  if (committed && opts.push !== false && hasRemote(repo)) {
    git(repo, ["push", "-u", "origin", "HEAD"]);
    pushed = true;
  }
  return { exported, committed, pushed };
}

export interface SyncPullResult {
  pulled: boolean;
  imported: ImportResult[];
}

function hasCommits(repo: string): boolean {
  try {
    git(repo, ["rev-parse", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function pullRemote(repo: string): void {
  if (!hasCommits(repo)) {
    // fresh clone-less repo: adopt the remote branch
    git(repo, ["fetch", "origin"]);
    try {
      git(repo, ["reset", "--hard", "origin/HEAD"]);
    } catch {
      git(repo, ["reset", "--hard", "origin/main"]);
    }
    return;
  }
  git(repo, ["pull", "--ff-only"]);
}

/** Pull the repo (when it has a remote) and import any sessions missing locally. */
export function syncPull(
  db: DatabaseSync,
  repo: string,
  opts: { pull?: boolean; overwrite?: boolean } = {},
): SyncPullResult {
  ensureRepo(repo);
  let pulled = false;
  if (opts.pull !== false && hasRemote(repo)) {
    pullRemote(repo);
    pulled = true;
  }
  const imported = importAllSessions(db, repo, { overwrite: opts.overwrite ?? false });
  return { pulled, imported };
}

export interface SyncStatus {
  repo: string;
  initialized: boolean;
  remotes: string[];
  branch: string;
  dirtyFiles: string[];
  lastCommit: string | null;
}

export function syncStatus(repo: string): SyncStatus {
  if (!existsSync(join(repo, ".git"))) {
    return { repo, initialized: false, remotes: [], branch: "", dirtyFiles: [], lastCommit: null };
  }
  const dirty = git(repo, ["status", "--porcelain"]);
  let lastCommit: string | null = null;
  try {
    lastCommit = git(repo, ["log", "-1", "--oneline"]);
  } catch {
    lastCommit = null; // no commits yet
  }
  return {
    repo,
    initialized: true,
    remotes: git(repo, ["remote", "-v"]).split("\n").filter(Boolean),
    branch: git(repo, ["branch", "--show-current"]),
    dirtyFiles: dirty ? dirty.split("\n") : [],
    lastCommit,
  };
}
