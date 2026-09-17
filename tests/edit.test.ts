import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendUserMessage,
  archiveSession,
  editMessageJson,
  editPartJson,
  editPartText,
  removeMessage,
  renameSession,
  replaceInPart,
} from "../src/edit.js";
import { getMessages, getPart, getSession, listSessions, loadFullSession } from "../src/store.js";
import { createFixture, seedExchange, seedSession } from "./helpers.js";

test("edit: rewrite CoT (reasoning part text) and find/replace", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx);
    const { parts } = seedExchange(fx, s.id, { cot: "I will run rm -rf /tmp/x then done" });
    const cot = parts.find((p) => JSON.parse(p.data).type === "reasoning")!;

    editPartText(fx.db, cot.id, "completely new reasoning");
    assert.equal(JSON.parse(getPart(fx.db, cot.id)!.data).text, "completely new reasoning");

    const n = replaceInPart(fx.db, cot.id, "new", "rewritten");
    assert.equal(n, 1);
    assert.equal(JSON.parse(getPart(fx.db, cot.id)!.data).text, "completely rewritten reasoning");
    assert.equal(replaceInPart(fx.db, cot.id, "absent", "x"), 0);

    // non-text parts rejected
    const t = Date.now();
    fx.db
      .prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("prt_step0000000000000000001", cot.message_id, s.id, t, t, JSON.stringify({ type: "step-start" }));
    assert.throws(() => editPartText(fx.db, "prt_step0000000000000000001", "x"), /step-start/);
  } finally {
    fx.cleanup();
  }
});

test("edit: raw JSON on missing part throws", () => {
  const fx = createFixture();
  try {
    assert.throws(
      () => editPartJson(fx.db, "prt_missing00000000000000", "{}"),
      /part not found/,
    );
  } finally {
    fx.cleanup();
  }
});

test("edit: raw JSON, rename, archive, append, remove", () => {
  const fx2 = createFixture();
  try {
    const s = seedSession(fx2, { title: "before", slug: "editme2" });
    const { userMessage, assistantMessage, parts } = seedExchange(fx2, s.id);

    editPartJson(fx2.db, parts[0]!.id, JSON.stringify({ type: "text", text: "replaced raw" }));
    assert.equal(JSON.parse(getPart(fx2.db, parts[0]!.id)!.data).text, "replaced raw");
    assert.throws(() => editPartJson(fx2.db, parts[0]!.id, "{bad json"));

    editMessageJson(fx2.db, userMessage.id, JSON.stringify({ role: "user", agent: "build", edited: true }));
    assert.equal(JSON.parse(getMessages(fx2.db, s.id)[0]!.data).edited, true);

    renameSession(fx2.db, s.id, "after");
    assert.equal(getSession(fx2.db, s.id)!.title, "after");

    archiveSession(fx2.db, s.id, true);
    assert.equal(listSessions(fx2.db).length, 0);
    assert.equal(listSessions(fx2.db, { includeArchived: true }).length, 1);
    archiveSession(fx2.db, s.id, false);
    assert.equal(listSessions(fx2.db).length, 1);

    const appended = appendUserMessage(fx2.db, s.id, "manual follow-up");
    assert.equal(getMessages(fx2.db, s.id).length, 3);
    assert.equal(JSON.parse(getPart(fx2.db, appended.part.id)!.data).text, "manual follow-up");

    removeMessage(fx2.db, assistantMessage.id);
    const full = loadFullSession(fx2.db, s.id);
    assert.equal(full.messages.length, 2);
  } finally {
    fx2.cleanup();
  }
});
