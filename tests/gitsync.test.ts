import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureRepo, syncPull, syncPush, syncStatus } from "../src/gitsync.js";
import { getSession, getMessages } from "../src/store.js";
import { createFixture, seedExchange, seedSession } from "./helpers.js";

function tmpRepo(): { path: string; cleanup(): void } {
  const path = mkdtempSync(join(tmpdir(), "ocs-repo-"));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

test("gitsync: push exports and commits; status reports", () => {
  const fx = createFixture();
  const repo = tmpRepo();
  try {
    const s = seedSession(fx, { slug: "syncme" });
    seedExchange(fx, s.id);

    assert.equal(ensureRepo(repo.path), true);
    assert.equal(ensureRepo(repo.path), false);

    const res = syncPush(fx.db, repo.path);
    assert.deepEqual(res.exported, [join(repo.path, "sessions", s.id)]);
    assert.equal(res.committed, true);
    assert.equal(res.pushed, false); // no remote

    const st = syncStatus(repo.path);
    assert.equal(st.initialized, true);
    assert.equal(st.branch, "main");
    assert.equal(st.dirtyFiles.length, 0);
    assert.ok(st.lastCommit?.includes("ocs: export"));

    // no changes -> no new commit
    const res2 = syncPush(fx.db, repo.path);
    assert.equal(res2.committed, false);
  } finally {
    fx.cleanup();
    repo.cleanup();
  }
});

test("gitsync: full round-trip through a bare remote (github-style)", () => {
  const a = createFixture(); // machine A store
  const b = createFixture(); // machine B store
  const remote = tmpRepo(); // bare "github"
  const repoA = tmpRepo();
  const repoB = tmpRepo();
  try {
    execFileSync("git", ["init", "--bare", "-b", "main", remote.path]);

    const s = seedSession(a, { title: "shared session", slug: "shared" });
    seedExchange(a, s.id, { cot: "synced cot" });

    ensureRepo(repoA.path);
    execFileSync("git", ["-C", repoA.path, "remote", "add", "origin", remote.path]);
    const pushed = syncPush(a.db, repoA.path);
    assert.equal(pushed.pushed, true);

    ensureRepo(repoB.path);
    execFileSync("git", ["-C", repoB.path, "remote", "add", "origin", remote.path]);
    const pulled = syncPull(b.db, repoB.path);
    assert.equal(pulled.pulled, true);
    assert.equal(pulled.imported.length, 1);
    assert.equal(pulled.imported[0]!.status, "imported");

    const sOnB = getSession(b.db, s.id)!;
    assert.equal(sOnB.title, "shared session");
    assert.equal(getMessages(b.db, s.id).length, 2);
  } finally {
    a.cleanup();
    b.cleanup();
    remote.cleanup();
    repoA.cleanup();
    repoB.cleanup();
  }
});
