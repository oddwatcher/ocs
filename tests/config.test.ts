import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferCredentialKind, loadConfig, saveConfig, validateConfig } from "../src/config.js";

function tmp(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "ocs-config-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("config: save/load round-trip with 0600 permissions", () => {
  const t = tmp();
  try {
    const p = join(t.dir, "sub", "config.json");
    saveConfig(
      { remote: { url: "https://github.com/u/r.git", name: "r", credential: { type: "https", token: "ghp_x" } } },
      p,
    );
    assert.equal(statSync(p).mode & 0o777, 0o600, "config must be owner-only");
    const loaded = loadConfig(p);
    assert.equal(loaded.remote!.url, "https://github.com/u/r.git");
    assert.equal((loaded.remote!.credential as { token: string }).token, "ghp_x");
    assert.deepEqual(loadConfig(join(t.dir, "missing.json")), {});
  } finally {
    t.cleanup();
  }
});

test("config: validation and kind inference", () => {
  assert.throws(() => validateConfig({ remote: { url: "u", credential: { type: "ssh", keyPath: "" } } }), /keyPath/);
  assert.throws(
    () => validateConfig({ remote: { url: "u", credential: { type: "https", token: "" } } }),
    /token/,
  );
  assert.equal(inferCredentialKind("git@github.com:u/r.git"), "ssh");
  assert.equal(inferCredentialKind("ssh://git@host/r.git"), "ssh");
  assert.equal(inferCredentialKind("https://github.com/u/r.git"), "https");
  assert.throws(() => inferCredentialKind("/local/path"), /cannot infer/);
});

test("config: corrupted json surfaces a parse error, not a crash", () => {
  const t = tmp();
  try {
    const p = join(t.dir, "config.json");
    writeFileSync(p, "{nope");
    assert.throws(() => loadConfig(p), SyntaxError);
  } finally {
    t.cleanup();
  }
});
