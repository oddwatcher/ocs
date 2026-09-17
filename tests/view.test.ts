import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSessionList, renderTranscript, showSession } from "../src/view.js";
import { loadFullSession } from "../src/store.js";
import { createFixture, seedExchange, seedSession } from "./helpers.js";

test("view: session list table", () => {
  const fx = createFixture();
  try {
    seedSession(fx, { title: "alpha work", slug: "slug-a" });
    seedSession(fx, { title: "beta work", slug: "slug-b" });
    const out = formatSessionList(fx.db);
    const lines = out.split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines.some((l) => l.includes("alpha work")));
    assert.ok(lines.every((l) => l.includes("/tmp/project")));
  } finally {
    fx.cleanup();
  }
});

test("view: transcript renders roles, text and CoT; can hide reasoning", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx);
    seedExchange(fx, s.id, { text: "do a thing", cot: "my chain of thought" });
    const full = loadFullSession(fx.db, s.id);

    const withCot = renderTranscript(full);
    assert.ok(withCot.includes("USER"));
    assert.ok(withCot.includes("ASSISTANT"));
    assert.ok(withCot.includes("do a thing"));
    assert.ok(withCot.includes("my chain of thought"));
    assert.ok(withCot.includes(`session ${s.id}`));

    const noCot = renderTranscript(full, { showReasoning: false });
    assert.ok(!noCot.includes("my chain of thought"));
    assert.ok(noCot.includes("hi there"));
  } finally {
    fx.cleanup();
  }
});

test("view: truncation and tool parts", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx);
    const { assistantMessage } = seedExchange(fx, s.id);
    const t = Date.now();
    fx.db
      .prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        "prt_tool000000000000000001",
        assistantMessage.id,
        s.id,
        t,
        t,
        JSON.stringify({ type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" }, output: "ok" } }),
      );
    const full = loadFullSession(fx.db, s.id);
    const out = renderTranscript(full, { maxPartChars: 8 });
    assert.ok(out.includes("[tool: bash] (completed)"));
    assert.ok(out.includes("truncated"));
    const noTools = renderTranscript(full, { showTools: false });
    assert.ok(!noTools.includes("[tool: bash]"));
    // showSession smoke test
    assert.ok(showSession(fx.db, s.id).includes("session " + s.id));
  } finally {
    fx.cleanup();
  }
});
