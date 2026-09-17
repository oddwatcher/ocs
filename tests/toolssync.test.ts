import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listToolsSources, pullToolsSource, pushTools, pushToolsSource } from "../src/toolssync.js";

function tmp(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "ocs-tools-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeToolsDir(base: string): string {
  const dir = join(base, "tooling");
  mkdirSync(join(dir, "plugins"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "msgpackr"), { recursive: true });
  writeFileSync(join(dir, "plugins", "prolong.ts"), "// plugin");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { msgpackr: "^1" } }));
  writeFileSync(join(dir, "node_modules", "msgpackr", "index.js"), "module.exports = {}");
  return dir;
}

test("toolssync: push copies files and archives node_modules; .git excluded", () => {
  const t = tmp();
  try {
    const repo = join(t.dir, "repo");
    const src = makeToolsDir(t.dir);
    mkdirSync(join(src, ".git"), { recursive: true });
    writeFileSync(join(src, ".git", "HEAD"), "ref: refs/heads/main");

    const res = pushToolsSource(repo, { label: "global", dir: src });
    assert.equal(res.nodeModulesArchived, true);
    const dst = join(repo, "tools", "global");
    assert.ok(existsSync(join(dst, "plugins", "prolong.ts")));
    assert.ok(existsSync(join(dst, "node_modules.tar.gz")));
    assert.ok(!existsSync(join(dst, "node_modules")), "node_modules not copied as tree");
    assert.ok(!existsSync(join(dst, ".git")), ".git excluded");
  } finally {
    t.cleanup();
  }
});

test("toolssync: pull restores files and node_modules exactly", () => {
  const t = tmp();
  try {
    const repo = join(t.dir, "repo");
    execFileSync("git", ["init", "-b", "main", repo]);
    const src = makeToolsDir(t.dir);
    pushTools(repo, [{ label: "proj", dir: src }]);
    assert.deepEqual(listToolsSources(repo), ["proj"]);

    const dest = join(t.dir, "restored");
    const res = pullToolsSource(repo, "proj", dest);
    assert.equal(res.nodeModulesRestored, true);
    assert.equal(readFileSync(join(dest, "plugins", "prolong.ts"), "utf8"), "// plugin");
    assert.equal(
      readFileSync(join(dest, "node_modules", "msgpackr", "index.js"), "utf8"),
      "module.exports = {}",
    );
    assert.ok(!existsSync(join(dest, "node_modules.tar.gz")), "tarball not copied to target");

    // commit was created
    const log = execFileSync("git", ["-C", repo, "log", "--oneline"], { encoding: "utf8" });
    assert.ok(log.includes("ocs: sync tools"));
  } finally {
    t.cleanup();
  }
});

test("toolssync: pull of unknown label fails; source without node_modules works", () => {
  const t = tmp();
  try {
    const repo = join(t.dir, "repo");
    execFileSync("git", ["init", "-b", "main", repo]);
    const src = join(t.dir, "bare");
    mkdirSync(join(src, "plugins"), { recursive: true });
    writeFileSync(join(src, "plugins", "a.ts"), "// a");
    const res = pushTools(repo, [{ label: "bare", dir: src }]);
    assert.equal(res[0]!.nodeModulesArchived, false);
    assert.throws(() => pullToolsSource(repo, "nope", join(t.dir, "x")), /no tools snapshot/);
  } finally {
    t.cleanup();
  }
});
