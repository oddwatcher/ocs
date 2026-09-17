// Test helpers: build a throwaway opencode-shaped SQLite store in a temp dir.
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "../src/ids.js";
import type { MessageRow, PartRow, SessionRow } from "../src/types.js";

export interface Fixture {
  dir: string;
  dbPath: string;
  db: DatabaseSync;
  cleanup(): void;
}

export function createFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "ocs-test-"));
  const dbPath = join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL DEFAULT 'global',
      workspace_id text,
      parent_id text,
      slug text NOT NULL DEFAULT '',
      directory text NOT NULL DEFAULT '',
      path text NOT NULL DEFAULT '',
      title text NOT NULL DEFAULT '',
      version text NOT NULL DEFAULT '',
      share_url text,
      summary_additions integer NOT NULL DEFAULT 0,
      summary_deletions integer NOT NULL DEFAULT 0,
      summary_files integer NOT NULL DEFAULT 0,
      summary_diffs text,
      metadata text,
      cost real NOT NULL DEFAULT 0,
      tokens_input integer NOT NULL DEFAULT 0,
      tokens_output integer NOT NULL DEFAULT 0,
      tokens_reasoning integer NOT NULL DEFAULT 0,
      tokens_cache_read integer NOT NULL DEFAULT 0,
      tokens_cache_write integer NOT NULL DEFAULT 0,
      revert text,
      permission text,
      agent text,
      model text,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      time_compacting integer,
      time_archived integer
    );
    CREATE TABLE message (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY,
      message_id text NOT NULL,
      session_id text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      data text NOT NULL
    );
    CREATE TABLE todo (
      session_id text NOT NULL,
      content text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      priority text NOT NULL DEFAULT 'medium',
      position integer NOT NULL DEFAULT 0,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    );
  `);
  return {
    dir,
    dbPath,
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function seedSession(fx: Fixture, overrides: Partial<SessionRow> = {}): SessionRow {
  const now = Date.now();
  const row: SessionRow = {
    id: newId("ses", now),
    project_id: "global",
    workspace_id: null,
    parent_id: null,
    slug: "test-slug",
    directory: "/tmp/project",
    path: "tmp/project",
    title: "Test session",
    version: "1.18.31",
    share_url: null,
    summary_additions: 0,
    summary_deletions: 0,
    summary_files: 0,
    summary_diffs: null,
    metadata: null,
    cost: 0,
    tokens_input: 0,
    tokens_output: 0,
    tokens_reasoning: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    revert: null,
    permission: null,
    agent: "build",
    model: JSON.stringify({ id: "m", providerID: "p", variant: "high" }),
    time_created: now,
    time_updated: now,
    time_compacting: null,
    time_archived: null,
    ...overrides,
  };
  const cols = Object.keys(row).join(", ");
  const marks = Object.keys(row).map(() => "?").join(", ");
  fx.db.prepare(`INSERT INTO session (${cols}) VALUES (${marks})`).run(...Object.values(row) as never[]);
  return row;
}

export interface SeededExchange {
  userMessage: MessageRow;
  assistantMessage: MessageRow;
  parts: PartRow[];
}

/** Seed a user prompt + assistant reply with text, reasoning (CoT) and tool parts. */
export function seedExchange(fx: Fixture, sessionId: string, opts?: { text?: string; cot?: string }): SeededExchange {
  const t = Date.now();
  const userMessage: MessageRow = {
    id: newId("msg", t),
    session_id: sessionId,
    time_created: t,
    time_updated: t,
    data: JSON.stringify({ role: "user", time: { created: t }, agent: "build" }),
  };
  const userPart: PartRow = {
    id: newId("prt", t),
    message_id: userMessage.id,
    session_id: sessionId,
    time_created: t,
    time_updated: t,
    data: JSON.stringify({ type: "text", text: opts?.text ?? "hello" }),
  };
  const t2 = t + 1;
  const assistantMessage: MessageRow = {
    id: newId("msg", t2),
    session_id: sessionId,
    time_created: t2,
    time_updated: t2,
    data: JSON.stringify({ role: "assistant", parentID: userMessage.id, agent: "build" }),
  };
  const reasoningPart: PartRow = {
    id: newId("prt", t2),
    message_id: assistantMessage.id,
    session_id: sessionId,
    time_created: t2,
    time_updated: t2,
    data: JSON.stringify({ type: "reasoning", text: opts?.cot ?? "thinking..." }),
  };
  const replyPart: PartRow = {
    id: newId("prt", t2 + 1),
    message_id: assistantMessage.id,
    session_id: sessionId,
    time_created: t2 + 1,
    time_updated: t2 + 1,
    data: JSON.stringify({ type: "text", text: "hi there" }),
  };
  const insertMsg = fx.db.prepare(
    "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
  );
  const insertPrt = fx.db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const m of [userMessage, assistantMessage]) {
    insertMsg.run(m.id, m.session_id, m.time_created, m.time_updated, m.data);
  }
  const parts = [userPart, reasoningPart, replyPart];
  for (const p of parts) {
    insertPrt.run(p.id, p.message_id, p.session_id, p.time_created, p.time_updated, p.data);
  }
  return { userMessage, assistantMessage, parts };
}
