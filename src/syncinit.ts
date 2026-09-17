// `ocs sync init`: one-shot setup of the sync remote.
// ocs owns the endpoint + credentials (stored in its own 0600 config);
// the user only provides endpoint, repo name, and one credential.
import { existsSync } from "node:fs";
import type { Credential, OcsConfig } from "./config.js";
import { inferCredentialKind, loadConfig, saveConfig } from "./config.js";
import { detectGit, ensureRepo, probeRemote, wireRemote } from "./gitsync.js";

export interface SyncInitOptions {
  /** git endpoint: git@github.com:user/repo.git or https://github.com/user/repo.git */
  endpoint: string;
  /** repo name for API creation; default: basename of endpoint minus .git */
  name?: string;
  sshKey?: string;
  token?: string;
  /** create the repo via the GitHub API when probing fails (needs https token) */
  create?: boolean;
  repo: string;
  configPath?: string;
  fetchImpl?: typeof fetch;
}

export interface SyncInitResult {
  gitVersion: string;
  credential: Credential | undefined;
  reachable: boolean;
  created: boolean;
  repo: string;
  configPath: string;
}

/** Parse "github.com/user/repo(.git)" out of an ssh or https endpoint. */
export function parseGitHubSlug(endpoint: string): { owner: string; name: string } | null {
  const m =
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(endpoint) ??
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(endpoint);
  return m ? { owner: m[1]!, name: m[2]! } : null;
}

/** Create a private GitHub repo via REST API. Injectable fetch for tests. */
export async function createGitHubRepo(
  token: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, private: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub repo creation failed (${res.status}): ${body}`);
  }
}

function buildCredential(opts: SyncInitOptions): Credential | undefined {
  let kind: "ssh" | "https";
  try {
    kind = inferCredentialKind(opts.endpoint);
  } catch {
    return undefined; // local path / file transport: no credential needed
  }
  if (kind === "ssh") {
    if (!opts.sshKey) return undefined; // hope ssh-agent/default keys work
    if (!existsSync(opts.sshKey)) throw new Error(`ssh key not found: ${opts.sshKey}`);
    return { type: "ssh", keyPath: opts.sshKey };
  }
  return opts.token ? { type: "https", token: opts.token } : undefined;
}

export async function syncInit(opts: SyncInitOptions): Promise<SyncInitResult> {
  const gitVersion = detectGit();
  const credential = buildCredential(opts);
  const slug = parseGitHubSlug(opts.endpoint);
  const name = opts.name ?? slug?.name ?? opts.endpoint.replace(/\.git$/, "").split("/").pop()!;

  let reachable = probeRemote(opts.endpoint, credential);
  let created = false;
  if (!reachable && opts.create) {
    if (!credential || credential.type !== "https" || !slug) {
      throw new Error(
        "--create requires an https github.com endpoint with --token " +
          "(repo creation goes through the GitHub REST API)",
      );
    }
    await createGitHubRepo(credential.token, name, opts.fetchImpl);
    created = true;
    reachable = probeRemote(opts.endpoint, credential);
    if (!reachable) throw new Error("repo was created but the endpoint still does not answer ls-remote");
  }

  ensureRepo(opts.repo);
  wireRemote(opts.repo, opts.endpoint);

  const config: OcsConfig = loadConfig(opts.configPath);
  config.remote = { url: opts.endpoint, name, ...(credential ? { credential } : {}) };
  const configPath = saveConfig(config, opts.configPath);

  return { gitVersion, credential, reachable, created, repo: opts.repo, configPath };
}
