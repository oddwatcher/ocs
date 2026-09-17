import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exportSession, importSession, listExportedSessions, readExportedSession, sessionDir } from "../src/exporter.js";
import { getMessages, getSession, updatePartData } from "../src/store.js";
import { createFixture, seedExchange, seedSession } from "./helpers.js";

test("export: writes session.json, messages.json, todos.json, transcript.md", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx, { title: "export me", slug: "export-me" });
    seedExchange(fx, s.id, { cot: "exportable cot" });
    const dir = exportSession(fx.db, s.id, fx.dir);
    assert.equal(dir, sessionDir(fx.dir, s.id));
    for (const f of ["session.json", "messages.json", "todos.json", "transcript.md"]) {
      assert.ok(existsSync(join(dir, f)), f);
    }
    const roundtrip = readExportedSession(dir);
    assert.equal(roundtrip.session.id, s.id);
    assert.equal(roundtrip.messages.length, 2);
    assert.equal(roundtrip.messages[1]!.parts.length, 2);
    assert.ok(readFileSync(join(dir, "transcript.md"), "utf8").includes("exportable cot"));
  } finally {
    fx.cleanup();
  }
});

test("import: round-trips into a fresh store; skips existing; overwrites on demand", () => {
  const src = createFixture();
  const dst = createFixture();
  try {
    const s = seedSession(src, { title: "original", slug: "orig" });
    const { parts } = seedExchange(src, s.id);
    const dir = exportSession(src.db, s.id, src.dir);

    const r1 = importSession(dst.db, dir);
    assert.equal(r1.status, "imported");
    assert.equal(getSession(dst.db, s.id)!.title, "original");
    assert.equal(getMessages(dst.db, s.id).length, 2);

    const r2 = importSession(dst.db, dir);
    assert.equal(r2.status, "skipped-existing");

    // mutate source (edit CoT), re-export, import with overwrite
    const reasoning = parts.find((p) => JSON.parse(p.data).type === "reasoning")!;
    updatePartData(src.db, reasoning.id, JSON.stringify({ type: "reasoning", text: "rewritten cot" }));
    const dir2 = exportSession(src.db, s.id, src.dir);
    const r3 = importSession(dst.db, dir2, { overwrite: true });
    assert.equal(r3.status, "overwritten");
    const msgs = getMessages(dst.db, s.id);
    assert.equal(msgs.length, 2);
    const cot = dst.db
      .prepare("SELECT data FROM part WHERE id = ?")
      .get(reasoning.id) as { data: string };
    assert.equal(JSON.parse(cot.data).text, "rewritten cot");

    assert.deepEqual(listExportedSessions(src.dir), [sessionDir(src.dir, s.id)]);
  } finally {
    src.cleanup();
    dst.cleanup();
  }
});
