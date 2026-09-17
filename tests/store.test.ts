import { test } from "node:test";
import assert from "node:assert/strict";
import { newId } from "../src/ids.js";
import {
  deleteMessageCascade,
  getMessages,
  getPart,
  getPartsForMessage,
  getSession,
  listSessions,
  loadFullSession,
  resolveSessionId,
  updatePartData,
  updateSessionFields,
} from "../src/store.js";
import { createFixture, seedExchange, seedSession } from "./helpers.js";

test("ids: format, uniqueness, ordering", () => {
  const a = newId("ses", 1789634928895);
  const b = newId("ses", 1789634928895); // same ms -> counter bump
  const c = newId("ses", 1789634928896);
  assert.match(a, /^ses_[0-9a-f]{12}[0-9a-zA-Z]{14}$/);
  assert.notEqual(a, b);
  assert.ok(a < b, "same-ms ids must sort by counter");
  assert.ok(b < c, "later-ms ids must sort after earlier ones");
});

test("store: list, get, resolve prefix", () => {
  const fx = createFixture();
  try {
    const s1 = seedSession(fx, { title: "alpha work", slug: "slug-a" });
    const s2 = seedSession(fx, { title: "beta work", slug: "slug-b", time_updated: Date.now() + 10 });
    const all = listSessions(fx.db);
    assert.equal(all.length, 2);
    assert.equal(all[0]!.id, s2.id, "most recently updated first");
    assert.equal(listSessions(fx.db, { query: "alpha" })[0]!.id, s1.id);
    assert.equal(getSession(fx.db, s1.id)!.title, "alpha work");
    assert.equal(resolveSessionId(fx.db, s1.id.slice(0, 20)), s1.id);
    assert.equal(resolveSessionId(fx.db, s2.slug), s2.id);
  } finally {
    fx.cleanup();
  }
});

test("store: loadFullSession with messages, parts, CoT", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx);
    seedExchange(fx, s.id, { text: "do a thing", cot: "secret chain of thought" });
    const full = loadFullSession(fx.db, s.id);
    assert.equal(full.messages.length, 2);
    const parts = full.messages[1]!.parts;
    assert.equal(parts.length, 2);
    const reasoning = parts.find((p) => JSON.parse(p.data).type === "reasoning");
    assert.equal(JSON.parse(reasoning!.data).text, "secret chain of thought");
    assert.equal(getMessages(fx.db, s.id).length, 2);
    assert.ok(getPartsForMessage(fx.db, full.messages[0]!.message.id).length >= 1);
  } finally {
    fx.cleanup();
  }
});

test("store: update part data (CoT edit) and session fields", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx);
    const { parts } = seedExchange(fx, s.id);
    const reasoning = parts.find((p) => JSON.parse(p.data).type === "reasoning")!;
    updatePartData(fx.db, reasoning.id, JSON.stringify({ type: "reasoning", text: "edited cot" }));
    assert.equal(JSON.parse(getPart(fx.db, reasoning.id)!.data).text, "edited cot");
    updateSessionFields(fx.db, s.id, { title: "renamed" });
    assert.equal(getSession(fx.db, s.id)!.title, "renamed");
  } finally {
    fx.cleanup();
  }
});

test("store: deleteMessageCascade removes parts too", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx);
    const { assistantMessage } = seedExchange(fx, s.id);
    deleteMessageCascade(fx.db, assistantMessage.id);
    assert.equal(getMessages(fx.db, s.id).length, 1);
    assert.equal(getPartsForMessage(fx.db, assistantMessage.id).length, 0);
  } finally {
    fx.cleanup();
  }
});
