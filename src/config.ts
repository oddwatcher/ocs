// ocs-owned configuration: git endpoint, repo name, credentials.
// Stored in ~/.config/ocs/config.json with mode 0600 — secrets live here and
// nowhere else (never in the sync repo's .git/config, never in exports).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Credential =
  | { type: "ssh"; keyPath: string }
  | { type: "https"; token: string };

export interface OcsConfig {
  remote?: {
    /** git endpoint, e.g. git@github.com:user/repo.git or https://github.com/user/repo.git */
    url: string;
    /** repo name (for display / API creation) */
    name?: string;
    credential?: Credential;
  };
}

export function defaultConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configHome, "ocs", "config.json");
}

export function resolveConfigPath(explicit?: string): string {
  return explicit ?? process.env.OCS_CONFIG ?? defaultConfigPath();
}

export function loadConfig(path?: string): OcsConfig {
  const p = resolveConfigPath(path);
  if (!existsSync(p)) return {};
  const parsed = JSON.parse(readFileSync(p, "utf8")) as OcsConfig;
  validateConfig(parsed);
  return parsed;
}

export function saveConfig(config: OcsConfig, path?: string): string {
  validateConfig(config);
  const p = resolveConfigPath(path);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(p, 0o600); // also tighten pre-existing files
  return p;
}

export function validateConfig(config: OcsConfig): void {
  const cred = config.remote?.credential;
  if (!cred) return;
  if (cred.type === "ssh") {
    if (!cred.keyPath) throw new Error("ssh credential requires keyPath");
  } else if (cred.type === "https") {
    if (!cred.token) throw new Error("https credential requires token");
  } else {
    throw new Error(`unknown credential type: ${(cred as { type: string }).type}`);
  }
}

/**
 * Infer credential type from the endpoint when the user didn't say:
 * git@... / ssh://... => ssh, https://... => https.
 */
export function inferCredentialKind(url: string): "ssh" | "https" {
  if (url.startsWith("https://") || url.startsWith("http://")) return "https";
  if (url.startsWith("git@") || url.startsWith("ssh://")) return "ssh";
  throw new Error(`cannot infer transport from endpoint: ${url} (use ssh or https URL form)`);
}
