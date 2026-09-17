// Typed CRUD over the opencode session store.
import type { DatabaseSync } from "node:sqlite";
import type { FullSession, MessageRow, PartRow, SessionRow, TodoRow } from "./types.js";

export interface SessionFilter {
  /** substring match on title or directory */
  query?: string;
  limit?: number;
  includeArchived?: boolean;
}

export function listSessions(db: DatabaseSync, filter: SessionFilter = {}): SessionRow[] {
  let sql = "SELECT * FROM session";
  const args: Array<string | number> = [];
  const where: string[] = [];
  if (!filter.includeArchived) where.push("time_archived IS NULL");
  if (filter.query) {
    where.push("(title LIKE ? OR directory LIKE ? OR id LIKE ?)");
    const q = `%${filter.query}%`;
    args.push(q, q, q);
  }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY time_updated DESC";
  if (filter.limit) {
    sql += " LIMIT ?";
    args.push(filter.limit);
  }
  return db.prepare(sql).all(...args) as unknown as SessionRow[];
}

export function getSession(db: DatabaseSync, id: string): SessionRow | undefined {
  return db.prepare("SELECT * FROM session WHERE id = ?").get(id) as unknown as SessionRow | undefined;
}

/** Resolve a possibly-abbreviated session id (unique prefix match). */
export function resolveSessionId(db: DatabaseSync, idOrPrefix: string): string {
  const exact = getSession(db, idOrPrefix);
  if (exact) return exact.id;
  const rows = db
    .prepare("SELECT id FROM session WHERE id LIKE ? OR slug = ? LIMIT 2")
    .all(idOrPrefix + "%", idOrPrefix) as unknown as Array<{ id: string }>;
  if (rows.length === 1) return rows[0]!.id;
  if (rows.length === 0) throw new Error(`session not found: ${idOrPrefix}`);
  throw new Error(`ambiguous session prefix: ${idOrPrefix} (matches ${rows.map((r) => r.id).join(", ")})`);
}

export function getMessages(db: DatabaseSync, sessionId: string): MessageRow[] {
  return db
    .prepare("SELECT * FROM message WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId) as unknown as MessageRow[];
}

export function getParts(db: DatabaseSync, sessionId: string): PartRow[] {
  return db
    .prepare("SELECT * FROM part WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId) as unknown as PartRow[];
}

export function getPartsForMessage(db: DatabaseSync, messageId: string): PartRow[] {
  return db
    .prepare("SELECT * FROM part WHERE message_id = ? ORDER BY id ASC")
    .all(messageId) as unknown as PartRow[];
}

export function getPart(db: DatabaseSync, partId: string): PartRow | undefined {
  return db.prepare("SELECT * FROM part WHERE id = ?").get(partId) as unknown as PartRow | undefined;
}

export function getTodos(db: DatabaseSync, sessionId: string): TodoRow[] {
  return db
    .prepare("SELECT * FROM todo WHERE session_id = ? ORDER BY position ASC")
    .all(sessionId) as unknown as TodoRow[];
}

export function loadFullSession(db: DatabaseSync, sessionId: string): FullSession {
  const session = getSession(db, sessionId);
  if (!session) throw new Error(`session not found: ${sessionId}`);
  const messages = getMessages(db, sessionId).map((message) => ({
    message,
    parts: getPartsForMessage(db, message.id),
  }));
  return { session, messages, todos: getTodos(db, sessionId) };
}

// ---- writes (require a writable handle) ----

const SESSION_COLUMNS: Array<keyof SessionRow> = [
  "id", "project_id", "workspace_id", "parent_id", "slug", "directory", "path",
  "title", "version", "share_url", "summary_additions", "summary_deletions",
  "summary_files", "summary_diffs", "metadata", "cost", "tokens_input",
  "tokens_output", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write",
  "revert", "permission", "agent", "model", "time_created", "time_updated",
  "time_compacting", "time_archived",
];

export function insertSession(db: DatabaseSync, row: SessionRow): void {
  const cols = SESSION_COLUMNS.join(", ");
  const marks = SESSION_COLUMNS.map(() => "?").join(", ");
  db.prepare(`INSERT INTO session (${cols}) VALUES (${marks})`).run(
    ...SESSION_COLUMNS.map((c) => row[c]),
  );
}

export function insertMessage(db: DatabaseSync, row: MessageRow): void {
  db.prepare(
    "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
  ).run(row.id, row.session_id, row.time_created, row.time_updated, row.data);
}

export function insertPart(db: DatabaseSync, row: PartRow): void {
  db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.message_id, row.session_id, row.time_created, row.time_updated, row.data);
}

export function insertTodo(db: DatabaseSync, row: TodoRow): void {
  db.prepare(
    "INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(row.session_id, row.content, row.status, row.priority, row.position, row.time_created, row.time_updated);
}

export function updatePartData(db: DatabaseSync, partId: string, data: string, now = Date.now()): void {
  const res = db.prepare("UPDATE part SET data = ?, time_updated = ? WHERE id = ?").run(data, now, partId);
  if (res.changes === 0) throw new Error(`part not found: ${partId}`);
}

export function updateMessageData(db: DatabaseSync, messageId: string, data: string, now = Date.now()): void {
  const res = db.prepare("UPDATE message SET data = ?, time_updated = ? WHERE id = ?").run(data, now, messageId);
  if (res.changes === 0) throw new Error(`message not found: ${messageId}`);
}

export function updateSessionFields(
  db: DatabaseSync,
  sessionId: string,
  fields: Partial<Pick<SessionRow, "title" | "directory" | "parent_id" | "slug" | "time_archived">>,
  now = Date.now(),
): void {
  const keys = Object.keys(fields) as Array<keyof typeof fields>;
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE session SET ${set}, time_updated = ? WHERE id = ?`).run(
    ...keys.map((k) => fields[k] ?? null),
    now,
    sessionId,
  );
}

export function deleteMessageCascade(db: DatabaseSync, messageId: string): void {
  db.prepare("DELETE FROM part WHERE message_id = ?").run(messageId);
  db.prepare("DELETE FROM message WHERE id = ?").run(messageId);
}

export function deletePart(db: DatabaseSync, partId: string): void {
  db.prepare("DELETE FROM part WHERE id = ?").run(partId);
}

export function deleteSessionCascade(db: DatabaseSync, sessionId: string): void {
  db.prepare("DELETE FROM part WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM message WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM todo WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM session WHERE id = ?").run(sessionId);
}
