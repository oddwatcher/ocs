// Sync opencode tooling (plugins/agents/skills + their node_modules) between
// installations via the same git repo used for sessions.
//
// Layout inside the repo:
//   tools/<label>/...            files of the source dir (node_modules excluded)
//   tools/<label>/node_modules.tar.gz   tarball of node_modules, if present
//
// opencode's own dependency management for plugin dirs is poor, so the
// node_modules tarball guarantees an exact restore on the other machine.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureRepo } from "./gitsync.js";

export interface ToolsSource {
  /** short label used inside the repo, e.g. "global" or "opencode_addons" */
  label: string;
  /** directory to sync, e.g. ~/.config/opencode or <project>/.opencode */
  dir: string;
}

export function globalToolsSource(): ToolsSource {
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return { label: "global", dir: join(configHome, "opencode") };
}

function toolsDir(repo: string, label: string): string {
  return join(repo, "tools", label);
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (s) => !s.includes("node_modules") && !s.includes(`${sep()}.git`),
  });
}

function sep(): string {
  return "/";
}

function tarNodeModules(dir: string, outFile: string): boolean {
  const nm = join(dir, "node_modules");
  if (!existsSync(nm)) return false;
  execFileSync("tar", ["-czf", outFile, "-C", dir, "node_modules"]);
  return true;
}

function untarNodeModules(tarball: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  rmSync(join(destDir, "node_modules"), { recursive: true, force: true });
  execFileSync("tar", ["-xzf", tarball, "-C", destDir]);
}

export interface ToolsPushResult {
  label: string;
  files: number;
  nodeModulesArchived: boolean;
}

export function pushToolsSource(repo: string, src: ToolsSource): ToolsPushResult {
  if (!existsSync(src.dir)) throw new Error(`tools source does not exist: ${src.dir}`);
  const dst = toolsDir(repo, src.label);
  rmSync(dst, { recursive: true, force: true });
  copyTree(src.dir, dst);
  const nodeModulesArchived = tarNodeModules(src.dir, join(dst, "node_modules.tar.gz"));
  const files = readdirSync(dst, { recursive: true }).length;
  return { label: src.label, files, nodeModulesArchived };
}

export interface ToolsPullResult {
  label: string;
  restoredTo: string;
  nodeModulesRestored: boolean;
}

export function pullToolsSource(repo: string, label: string, destDir: string): ToolsPullResult {
  const src = toolsDir(repo, label);
  if (!existsSync(src)) throw new Error(`no tools snapshot "${label}" in repo`);
  mkdirSync(destDir, { recursive: true });
  // copy everything except the tarball
  cpSync(src, destDir, { recursive: true, filter: (s) => !s.endsWith("node_modules.tar.gz") });
  const tarball = join(src, "node_modules.tar.gz");
  const nodeModulesRestored = existsSync(tarball);
  if (nodeModulesRestored) untarNodeModules(tarball, destDir);
  return { label, restoredTo: destDir, nodeModulesRestored };
}

/** Labels of all tool snapshots present in the repo. */
export function listToolsSources(repo: string): string[] {
  const base = join(repo, "tools");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/** Push all given tool sources into the repo and commit. */
export function pushTools(repo: string, sources: ToolsSource[], message?: string): ToolsPushResult[] {
  ensureRepo(repo);
  const results = sources.map((s) => pushToolsSource(repo, s));
  execFileSync("git", ["-C", repo, "add", "-A"]);
  const dirty = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  if (dirty) {
    execFileSync("git", ["-C", repo, "-c", "user.name=ocs", "-c", "user.email=ocs@local", "commit", "-q", "-m",
      message ?? `ocs: sync tools (${sources.map((s) => s.label).join(", ")})`]);
  }
  return results;
}
