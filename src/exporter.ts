// Export a session to a git-friendly directory and import it back.
//
// Layout per session:
//   <dir>/<session-id>/session.json     session row
//   <dir>/<session-id>/messages.json    [{message, parts}] ordered
//   <dir>/<session-id>/todos.json       todo rows
//   <dir>/<session-id>/transcript.md    human-readable rendering
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getSession, insertMessage, insertPart, insertSession, insertTodo, loadFullSession } from "./store.js";
import type { FullSession, MessageRow, PartRow, SessionRow, TodoRow } from "./types.js";
import { renderTranscript } from "./view.js";

export interface ExportedMessage {
  message: MessageRow;
  parts: PartRow[];
}

export function sessionDir(root: string, sessionId: string): string {
  return join(root, "sessions", sessionId);
}

/** Export one session. Returns the directory written. */
export function exportSession(db: DatabaseSync, sessionId: string, root: string): string {
  const full = loadFullSession(db, sessionId);
  const dir = sessionDir(root, sessionId);
  mkdirSync(dir, { recursive: true });
  const pretty = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  writeFileSync(join(dir, "session.json"), pretty(full.session));
  writeFileSync(join(dir, "messages.json"), pretty(full.messages));
  writeFileSync(join(dir, "todos.json"), pretty(full.todos));
  writeFileSync(join(dir, "transcript.md"), renderTranscript(full));
  return dir;
}

/** Export every session matching the filter. Returns written dirs. */
export function exportAllSessions(db: DatabaseSync, root: string): string[] {
  const rows = db.prepare("SELECT id FROM session WHERE time_archived IS NULL").all() as unknown as Array<{ id: string }>;
  return rows.map((r) => exportSession(db, r.id, root));
}

export function readExportedSession(dir: string): FullSession {
  const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as SessionRow;
  const messages = JSON.parse(readFileSync(join(dir, "messages.json"), "utf8")) as ExportedMessage[];
  const todosPath = join(dir, "todos.json");
  const todos = existsSync(todosPath)
    ? (JSON.parse(readFileSync(todosPath, "utf8")) as TodoRow[])
    : [];
  return { session, messages, todos };
}

export interface ImportResult {
  sessionId: string;
  status: "imported" | "skipped-existing" | "overwritten";
}

/**
 * Import one exported session directory into the store.
 * Existing sessions are skipped unless `overwrite` is set (then rows are replaced).
 */
export function importSession(
  db: DatabaseSync,
  dir: string,
  opts: { overwrite?: boolean } = {},
): ImportResult {
  const full = readExportedSession(dir);
  const existing = getSession(db, full.session.id);
  if (existing && !opts.overwrite) {
    return { sessionId: full.session.id, status: "skipped-existing" };
  }
  db.exec("BEGIN");
  try {
    if (existing) {
      db.prepare("DELETE FROM part WHERE session_id = ?").run(full.session.id);
      db.prepare("DELETE FROM message WHERE session_id = ?").run(full.session.id);
      db.prepare("DELETE FROM todo WHERE session_id = ?").run(full.session.id);
      db.prepare("DELETE FROM session WHERE id = ?").run(full.session.id);
    }
    insertSession(db, full.session);
    for (const { message, parts } of full.messages) {
      insertMessage(db, message);
      for (const p of parts) insertPart(db, p);
    }
    for (const t of full.todos) insertTodo(db, t);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { sessionId: full.session.id, status: existing ? "overwritten" : "imported" };
}

/** List session export directories under a root. */
export function listExportedSessions(root: string): string[] {
  const base = join(root, "sessions");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(base, e.name, "session.json")))
    .map((e) => join(base, e.name));
}

/** Import every exported session found under root. */
export function importAllSessions(db: DatabaseSync, root: string, opts: { overwrite?: boolean } = {}): ImportResult[] {
  return listExportedSessions(root).map((dir) => importSession(db, dir, opts));
}
