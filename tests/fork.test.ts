import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { forkSession } from "../src/fork.js";
import { getMessages, getPartsForMessage, getSession, loadFullSession } from "../src/store.js";
import { createFixture, seedExchange, seedSession } from "./helpers.js";

test("fork: copies session with parent_id, remapped ids and parentID chain", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx, { title: "original", slug: "orig" });
    seedExchange(fx, s.id, { cot: "original cot" });
    seedExchange(fx, s.id, { text: "second round" });

    const res = forkSession(fx.db, s.id);
    assert.equal(res.messagesCopied, 4);
    assert.equal(res.partsCopied, 6);

    const fork = getSession(fx.db, res.session.id)!;
    assert.equal(fork.parent_id, s.id);
    assert.equal(fork.title, "Fork of original");
    assert.equal(fork.slug, "orig-fork");
    assert.notEqual(fork.id, s.id);

    // content preserved, ids remapped, assistant parentID points at copied user msg
    const full = loadFullSession(fx.db, fork.id);
    const cot = full.messages
      .flatMap((m) => m.parts)
      .map((p) => JSON.parse(p.data) as { type: string; text?: string })
      .find((p) => p.type === "reasoning");
    assert.equal(cot!.text, "original cot");
    assert.ok(full.messages.every((m) => m.message.session_id === fork.id));
    assert.ok(full.messages.every((m) => m.parts.every((p) => p.session_id === fork.id)));
    const firstAssistant = full.messages.find((m) => JSON.parse(m.message.data).role === "assistant")!;
    const parentId = (JSON.parse(firstAssistant.message.data) as { parentID: string }).parentID;
    assert.ok(full.messages.some((m) => m.message.id === parentId), "parentID remapped into fork");
    assert.ok(!getMessages(fx.db, s.id).some((m) => m.id === parentId), "not the source id");

    // message ids strictly increasing within fork
    const ids = full.messages.map((m) => m.message.id);
    assert.deepEqual([...ids].sort(), ids);

    // source untouched
    assert.equal(getMessages(fx.db, s.id).length, 4);
  } finally {
    fx.cleanup();
  }
});

test("fork: atMessage truncates history", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx);
    seedExchange(fx, s.id);
    const second = seedExchange(fx, s.id);
    const res = forkSession(fx.db, s.id, { atMessage: second.userMessage.id });
    assert.equal(res.messagesCopied, 3);
  } finally {
    fx.cleanup();
  }
});

test("fork: withWorktree forks the working dir as git branch+worktree", () => {
  const fx = createFixture();
  const repo = join(fx.dir, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"]);
  try {
    const s = seedSession(fx, { directory: repo, slug: "wt" });
    seedExchange(fx, s.id);
    const res = forkSession(fx.db, s.id, { withWorktree: true });
    assert.ok(res.worktree);
    const branches = execFileSync("git", ["-C", repo, "branch", "--list"], { encoding: "utf8" });
    assert.ok(branches.includes(res.worktree!.branch));
    assert.equal(getSession(fx.db, res.session.id)!.directory, res.worktree!.directory);
    assert.ok(getPartsForMessage.length > 0);
  } finally {
    execFileSync("git", ["-C", repo, "worktree", "list"], { stdio: "pipe" });
    fx.cleanup();
  }
});

test("fork: withWorktree on non-git dir fails cleanly", () => {
  const fx = createFixture();
  try {
    const s = seedSession(fx, { directory: fx.dir, slug: "nogit" });
    seedExchange(fx, s.id);
    assert.throws(() => forkSession(fx.db, s.id, { withWorktree: true }), /not a git repo/);
  } finally {
    fx.cleanup();
  }
});
