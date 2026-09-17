import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectGit, gitAuthArgs, gitAuthEnv, probeRemote } from "../src/gitsync.js";
import { createGitHubRepo, parseGitHubSlug, syncInit } from "../src/syncinit.js";
import { loadConfig } from "../src/config.js";

function tmp(): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "ocs-init-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("gitsync: git detection and credential injection construction", () => {
  assert.match(detectGit(), /^git version/);

  const sshArgs = gitAuthArgs({ type: "ssh", keyPath: "/k" });
  assert.equal(sshArgs.length, 0, "ssh uses env, not -c args");
  const sshEnv = gitAuthEnv({ type: "ssh", keyPath: "/k" });
  assert.equal(sshEnv.GIT_SSH_COMMAND, "ssh -i /k -o IdentitiesOnly=yes");

  const httpsArgs = gitAuthArgs({ type: "https", token: "ghp_x" });
  assert.equal(httpsArgs[0], "-c");
  assert.match(httpsArgs[1]!, /^http\.extraHeader=Authorization: Basic /);
  const decoded = Buffer.from(httpsArgs[1]!.split("Basic ")[1]!, "base64").toString();
  assert.equal(decoded, "x-access-token:ghp_x");
  assert.equal(gitAuthEnv({ type: "https", token: "ghp_x" }).GIT_SSH_COMMAND, undefined);

  assert.deepEqual(gitAuthArgs(undefined), []);
});

test("syncinit: slug parsing", () => {
  assert.deepEqual(parseGitHubSlug("git@github.com:user/repo.git"), { owner: "user", name: "repo" });
  assert.deepEqual(parseGitHubSlug("https://github.com/user/repo"), { owner: "user", name: "repo" });
  assert.equal(parseGitHubSlug("https://gitlab.com/user/repo.git"), null);
});

test("syncinit: wires a local endpoint, saves config with credential", async () => {
  const t = tmp();
  try {
    const bare = join(t.dir, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);
    const repo = join(t.dir, "repo");
    const configPath = join(t.dir, "config.json");
    const keyPath = join(t.dir, "id_test");
    writeFileSync(keyPath, "fake-key");

    // endpoint is a local path so inferCredentialKind can't classify it:
    // probe still works (local transport), credential omitted.
    const res = await syncInit({ endpoint: bare, repo, configPath });
    assert.match(res.gitVersion, /^git version/);
    assert.equal(res.reachable, true);
    assert.equal(res.created, false);
    assert.equal(res.credential, undefined);

    const cfg = loadConfig(configPath);
    assert.equal(cfg.remote!.url, bare);
    assert.equal(cfg.remote!.name, "remote");
    const remote = execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    assert.equal(remote, bare);

    // missing ssh key fails fast
    await assert.rejects(
      syncInit({ endpoint: "git@github.com:u/r.git", sshKey: "/nope", repo, configPath }),
      /ssh key not found/,
    );
  } finally {
    t.cleanup();
  }
});

test("syncinit: --create calls GitHub API with token (mocked fetch)", async () => {
  const t = tmp();
  try {
    const bare = join(t.dir, "newrepo.git");
    const repo = join(t.dir, "repo");
    const configPath = join(t.dir, "config.json");

    let apiCalled: { name: string; private: boolean } | null = null;
    const fakeFetch = (async (_url: unknown, init?: { body?: string }) => {
      apiCalled = JSON.parse(init!.body!);
      // simulate creation by making the local bare repo that the endpoint points at
      execFileSync("git", ["init", "--bare", "-b", "main", bare]);
      return { ok: true, text: async () => "" } as Response;
    }) as typeof fetch;

    // endpoint that fails probe until "created" — use a local path via https-looking url won't work,
    // so test createGitHubRepo directly + syncInit error path instead.
    await createGitHubRepo("tok", "newrepo", fakeFetch);
    assert.deepEqual(apiCalled, { name: "newrepo", private: true });

    // syncInit --create with non-github endpoint must refuse
    await assert.rejects(
      syncInit({ endpoint: "git@gitlab.com:u/r.git", token: "t", create: true, repo, configPath }),
      /--create requires an https github\.com endpoint/,
    );
  } finally {
    t.cleanup();
  }
});

test("syncinit: probeRemote false for dead endpoint, no crash", () => {
  assert.equal(probeRemote("/definitely/not/here.git"), false);
});
