// Locate and open the opencode session-store SQLite database.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

export function resolveDbPath(explicit?: string): string {
  const p = explicit ?? process.env.OCS_DB ?? defaultDbPath();
  if (!existsSync(p)) {
    throw new Error(`opencode database not found at ${p} (set OCS_DB to override)`);
  }
  return p;
}

/**
 * Open the store. Read-only by default so we never touch the WAL of a live
 * opencode instance unless a write command was explicitly requested.
 */
export function openStore(opts?: { path?: string; write?: boolean }): DatabaseSync {
  const p = resolveDbPath(opts?.path);
  return new DatabaseSync(p, { readOnly: !opts?.write });
}
