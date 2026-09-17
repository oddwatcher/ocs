// Surgical edits against the session store: CoT/text parts, raw JSON, titles,
// appending messages, deleting messages. All functions need a writable db handle.
import type { DatabaseSync } from "node:sqlite";
import { newId } from "./ids.js";
import {
  deleteMessageCascade,
  deletePart,
  getMessages,
  getPart,
  getSession,
  insertMessage,
  insertPart,
  resolveSessionId,
  updateMessageData,
  updatePartData,
  updateSessionFields,
} from "./store.js";
import type { MessageRow, PartData, PartRow } from "./types.js";

/** Replace the `text` of a text/reasoning (CoT) part, preserving other fields. */
export function editPartText(db: DatabaseSync, partId: string, newText: string): PartRow {
  const part = mustGetPart(db, partId);
  const data = JSON.parse(part.data) as PartData;
  if (data.type !== "text" && data.type !== "reasoning") {
    throw new Error(`part ${partId} is type "${data.type}"; only text/reasoning have editable text`);
  }
  data.text = newText;
  updatePartData(db, partId, JSON.stringify(data));
  return getPart(db, partId)!;
}

/** Find-and-replace inside a text/reasoning part (e.g. redact or rewrite CoT). */
export function replaceInPart(db: DatabaseSync, partId: string, find: string, replace: string): number {
  const part = mustGetPart(db, partId);
  const data = JSON.parse(part.data) as PartData;
  const text = String(data.text ?? "");
  const occurrences = text.split(find).length - 1;
  if (occurrences === 0) return 0;
  data.text = text.split(find).join(replace);
  updatePartData(db, partId, JSON.stringify(data));
  return occurrences;
}

/** Replace the whole JSON payload of a part. */
export function editPartJson(db: DatabaseSync, partId: string, json: string): void {
  JSON.parse(json); // validate
  mustGetPart(db, partId);
  updatePartData(db, partId, json);
}

/** Replace the whole JSON payload of a message. */
export function editMessageJson(db: DatabaseSync, messageId: string, json: string): void {
  JSON.parse(json); // validate
  updateMessageData(db, messageId, json);
}

export function renameSession(db: DatabaseSync, idOrPrefix: string, title: string): string {
  const id = resolveSessionId(db, idOrPrefix);
  updateSessionFields(db, id, { title });
  return id;
}

export function archiveSession(db: DatabaseSync, idOrPrefix: string, archived: boolean): string {
  const id = resolveSessionId(db, idOrPrefix);
  updateSessionFields(db, id, { time_archived: archived ? Date.now() : null });
  return id;
}

/** Append a new user message (with one text part) to a session. */
export function appendUserMessage(
  db: DatabaseSync,
  idOrPrefix: string,
  text: string,
  now = Date.now(),
): { message: MessageRow; part: PartRow } {
  const sessionId = resolveSessionId(db, idOrPrefix);
  const session = getSession(db, sessionId)!;
  const message: MessageRow = {
    id: newId("msg", now),
    session_id: sessionId,
    time_created: now,
    time_updated: now,
    data: JSON.stringify({
      role: "user",
      time: { created: now },
      agent: session.agent ?? "build",
      summary: { diffs: [] },
    }),
  };
  const part: PartRow = {
    id: newId("prt", now),
    message_id: message.id,
    session_id: sessionId,
    time_created: now,
    time_updated: now,
    data: JSON.stringify({ type: "text", text }),
  };
  insertMessage(db, message);
  insertPart(db, part);
  updateSessionFields(db, sessionId, {});
  return { message, part };
}

/** Delete a message and its parts from a session. */
export function removeMessage(db: DatabaseSync, messageId: string): void {
  deleteMessageCascade(db, messageId);
}

export function removePart(db: DatabaseSync, partId: string): void {
  deletePart(db, partId);
}

function mustGetPart(db: DatabaseSync, partId: string): PartRow {
  const part = getPart(db, partId);
  if (!part) throw new Error(`part not found: ${partId}`);
  return part;
}

export { getMessages };
