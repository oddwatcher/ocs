#!/usr/bin/env node
// ocs — opencode session store tool
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { openStore } from "./db.js";
import { resolveSessionId } from "./store.js";
import { formatSessionList, showSession } from "./view.js";
import { exportSession, exportAllSessions, importSession } from "./exporter.js";
import { forkSession } from "./fork.js";
import {
  appendUserMessage,
  archiveSession,
  editMessageJson,
  editPartJson,
  editPartText,
  removeMessage,
  removePart,
  renameSession,
  replaceInPart,
} from "./edit.js";
import { resolveRepoPath, syncPull, syncPush, syncStatus } from "./gitsync.js";
import { globalToolsSource, listToolsSources, pullToolsSource, pushTools } from "./toolssync.js";

const USAGE = `ocs — opencode session store tool

Usage:
  ocs ls [--query q] [--limit n] [--archived]          list sessions
  ocs show <session> [--no-reasoning] [--no-tools] [--max-chars n]
  ocs export <session|all> [--out dir]                 export session(s) to files
  ocs import <dir> [--overwrite]                       import an exported session dir
  ocs fork <session> [--title t] [--at <messageId>] [--worktree [--worktree-dir d]]
  ocs edit title <session> <title>
  ocs edit part-text <partId> (--text t | --file f)    edit text/CoT of a part
  ocs edit replace <partId> <find> <replace>           find/replace inside a part
  ocs edit part-json <partId> --file f                 replace part payload with JSON
  ocs edit message-json <messageId> --file f           replace message payload with JSON
  ocs edit append <session> <text>                     append a user message
  ocs edit rm-message <messageId>                      delete message + its parts
  ocs edit rm-part <partId>                            delete a part
  ocs edit archive <session> [--un]                    archive / unarchive
  ocs sync push [--repo r] [--session id]... [--no-push]
  ocs sync pull [--repo r] [--overwrite] [--no-pull]
  ocs sync status [--repo r]
  ocs tools push [--repo r] [--from dir] [--as label]  sync tooling into repo
  ocs tools pull [--repo r] <label> [--to dir]         restore tooling from repo
  ocs tools list [--repo r]

Environment:
  OCS_DB     path to opencode.db (default: $XDG_DATA_HOME/opencode/opencode.db)
  OCS_REPO   path to the sync repo (default: $XDG_DATA_HOME/ocs/repo)
`;

function fail(msg: string): never {
  console.error(`ocs: ${msg}`);
  process.exit(1);
}

function readTextSource(values: Record<string, unknown>): string {
  const text = values.text;
  const file = values.file;
  if (typeof text === "string") return text;
  if (typeof file === "string") return readFileSync(file, "utf8");
  fail("provide --text or --file");
}

function main(argv: string[]): void {
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(USAGE);
    return;
  }

  switch (cmd) {
    case "ls": {
      const { values } = parseArgs({
        args: argv.slice(1),
        options: {
          query: { type: "string" },
          limit: { type: "string" },
          archived: { type: "boolean", default: false },
        },
        strict: false,
      });
      const db = openStore();
      console.log(formatSessionList(db, {
        ...(typeof values.query === "string" ? { query: values.query } : {}),
        ...(typeof values.limit === "string" ? { limit: Number(values.limit) } : {}),
        includeArchived: values.archived === true,
      }));
      db.close();
      return;
    }
    case "show": {
      const target = sub ?? fail("show: missing session id");
      const { values } = parseArgs({
        args: rest,
        options: {
          reasoning: { type: "boolean", default: true },
          "no-reasoning": { type: "boolean", default: false },
          tools: { type: "boolean", default: true },
          "no-tools": { type: "boolean", default: false },
          "max-chars": { type: "string" },
        },
        strict: false,
      });
      const db = openStore();
      console.log(showSession(db, resolveSessionId(db, target), {
        showReasoning: values["no-reasoning"] !== true && values.reasoning !== false,
        showTools: values["no-tools"] !== true && values.tools !== false,
        ...(typeof values["max-chars"] === "string" ? { maxPartChars: Number(values["max-chars"]) } : {}),
      }));
      db.close();
      return;
    }
    case "export": {
      const target = sub ?? fail("export: missing session id or 'all'");
      const { values } = parseArgs({
        args: rest,
        options: { out: { type: "string", default: "." } },
        strict: false,
      });
      const out = String(values.out);
      const db = openStore();
      if (target === "all") {
        for (const dir of exportAllSessions(db, out)) console.log(dir);
      } else {
        console.log(exportSession(db, resolveSessionId(db, target), out));
      }
      db.close();
      return;
    }
    case "import": {
      const dir = sub ?? fail("import: missing directory");
      const { values } = parseArgs({
        args: rest,
        options: { overwrite: { type: "boolean", default: false } },
        strict: false,
      });
      const db = openStore({ write: true });
      const res = importSession(db, dir, { overwrite: values.overwrite === true });
      console.log(`${res.status}: ${res.sessionId}`);
      db.close();
      return;
    }
    case "fork": {
      const target = sub ?? fail("fork: missing session id");
      const { values } = parseArgs({
        args: rest,
        options: {
          title: { type: "string" },
          at: { type: "string" },
          worktree: { type: "boolean", default: false },
          "worktree-dir": { type: "string" },
        },
        strict: false,
      });
      const db = openStore({ write: true });
      const res = forkSession(db, target, {
        ...(typeof values.title === "string" ? { title: values.title } : {}),
        ...(typeof values.at === "string" ? { atMessage: values.at } : {}),
        withWorktree: values.worktree === true,
        ...(typeof values["worktree-dir"] === "string" ? { worktreeDir: values["worktree-dir"] } : {}),
      });
      console.log(`forked: ${res.session.id} (parent ${res.session.parent_id})`);
      console.log(`  copied ${res.messagesCopied} messages, ${res.partsCopied} parts`);
      if (res.worktree) console.log(`  worktree: ${res.worktree.directory} (branch ${res.worktree.branch})`);
      db.close();
      return;
    }
    case "edit": {
      cmdEdit(sub ?? fail("edit: missing action"), rest);
      return;
    }
    case "sync": {
      cmdSync(sub ?? fail("sync: missing action (push|pull|status)"), rest);
      return;
    }
    case "tools": {
      cmdTools(sub ?? fail("tools: missing action (push|pull|list)"), rest);
      return;
    }
    default:
      fail(`unknown command: ${cmd}\n\n${USAGE}`);
  }
}

function cmdEdit(action: string, args: string[]): void {
  const db = openStore({ write: true });
  try {
    switch (action) {
      case "title": {
        const [target, ...words] = args;
        if (!target || words.length === 0) fail("edit title: <session> <title>");
        const id = renameSession(db, target!, words.join(" "));
        console.log(`renamed ${id}`);
        return;
      }
      case "part-text": {
        const [partId, ...restArgs] = args;
        if (!partId) fail("edit part-text: <partId> (--text t | --file f)");
        const { values } = parseArgs({
          args: restArgs,
          options: { text: { type: "string" }, file: { type: "string" } },
          strict: false,
        });
        editPartText(db, partId, readTextSource(values));
        console.log(`updated ${partId}`);
        return;
      }
      case "replace": {
        const [partId, find, replace] = args;
        if (!partId || find === undefined || replace === undefined) fail("edit replace: <partId> <find> <replace>");
        const n = replaceInPart(db, partId, find, replace);
        console.log(`${n} replacement(s) in ${partId}`);
        return;
      }
      case "part-json":
      case "message-json": {
        const [id, ...restArgs] = args;
        if (!id) fail(`edit ${action}: <id> --file f`);
        const { values } = parseArgs({
          args: restArgs,
          options: { text: { type: "string" }, file: { type: "string" } },
          strict: false,
        });
        const json = readTextSource(values);
        if (action === "part-json") editPartJson(db, id, json);
        else editMessageJson(db, id, json);
        console.log(`updated ${id}`);
        return;
      }
      case "append": {
        const [target, ...words] = args;
        if (!target || words.length === 0) fail("edit append: <session> <text>");
        const { message } = appendUserMessage(db, target, words.join(" "));
        console.log(`appended ${message.id}`);
        return;
      }
      case "rm-message": {
        const [id] = args;
        if (!id) fail("edit rm-message: <messageId>");
        removeMessage(db, id);
        console.log(`removed ${id}`);
        return;
      }
      case "rm-part": {
        const [id] = args;
        if (!id) fail("edit rm-part: <partId>");
        removePart(db, id);
        console.log(`removed ${id}`);
        return;
      }
      case "archive": {
        const [target, ...restArgs] = args;
        if (!target) fail("edit archive: <session> [--un]");
        const { values } = parseArgs({ args: restArgs, options: { un: { type: "boolean" } }, strict: false });
        const id = archiveSession(db, target, values.un !== true);
        console.log(`${values.un === true ? "unarchived" : "archived"} ${id}`);
        return;
      }
      default:
        fail(`unknown edit action: ${action}`);
    }
  } finally {
    db.close();
  }
}

function cmdSync(action: string, args: string[]): void {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      session: { type: "string", multiple: true },
      push: { type: "boolean", default: true },
      "no-push": { type: "boolean", default: false },
      pull: { type: "boolean", default: true },
      "no-pull": { type: "boolean", default: false },
      overwrite: { type: "boolean", default: false },
    },
    strict: false,
  });
  const repo = resolveRepoPath(typeof values.repo === "string" ? values.repo : undefined);
  switch (action) {
    case "push": {
      const db = openStore();
      const res = syncPush(db, repo, {
        ...(Array.isArray(values.session) && values.session.length
          ? { sessionIds: values.session as string[] }
          : {}),
        push: values.push !== false && values["no-push"] !== true,
      });
      db.close();
      console.log(`exported ${res.exported.length} session(s) to ${repo}`);
      console.log(res.committed ? "committed" : "no changes");
      if (res.pushed) console.log("pushed to remote");
      return;
    }
    case "pull": {
      const db = openStore({ write: true });
      const res = syncPull(db, repo, { pull: values.pull !== false && values["no-pull"] !== true, overwrite: values.overwrite === true });
      db.close();
      if (res.pulled) console.log("pulled from remote");
      else console.log("(no remote configured; imported from local repo only)");
      if (res.imported.length === 0) console.log("no sessions to import");
      for (const r of res.imported) console.log(`${r.status}: ${r.sessionId}`);
      return;
    }
    case "status": {
      const st = syncStatus(repo);
      console.log(`repo:    ${st.repo} ${st.initialized ? "" : "(not initialized)"}`);
      if (!st.initialized) return;
      console.log(`branch:  ${st.branch}`);
      console.log(`remotes: ${st.remotes.length ? st.remotes.join("; ") : "(none)"}`);
      console.log(`last:    ${st.lastCommit ?? "(no commits)"}`);
      console.log(`dirty:   ${st.dirtyFiles.length ? st.dirtyFiles.join(", ") : "clean"}`);
      return;
    }
    default:
      fail(`unknown sync action: ${action}`);
  }
}

function cmdTools(action: string, args: string[]): void {
  switch (action) {
    case "push": {
      const { values } = parseArgs({
        args,
        options: { repo: { type: "string" }, from: { type: "string" }, as: { type: "string" } },
        strict: false,
      });
      const repo = resolveRepoPath(typeof values.repo === "string" ? values.repo : undefined);
      const src = values.from
        ? { label: String(values.as ?? "custom"), dir: String(values.from) }
        : globalToolsSource();
      const results = pushTools(repo, [src]);
      for (const r of results) {
        console.log(`${r.label}: ${r.files} file(s), node_modules ${r.nodeModulesArchived ? "archived" : "absent"}`);
      }
      return;
    }
    case "pull": {
      const { values, positionals } = parseArgs({
        args,
        options: { repo: { type: "string" }, to: { type: "string" } },
        allowPositionals: true,
        strict: false,
      });
      const label = positionals[0];
      if (!label) fail("tools pull: <label> [--to dir]");
      const repo = resolveRepoPath(typeof values.repo === "string" ? values.repo : undefined);
      const dest = values.to ? String(values.to) : globalToolsSource().dir;
      const res = pullToolsSource(repo, label, dest);
      console.log(`restored ${res.label} -> ${res.restoredTo} (node_modules ${res.nodeModulesRestored ? "restored" : "absent"})`);
      return;
    }
    case "list": {
      const { values } = parseArgs({ args, options: { repo: { type: "string" } }, strict: false });
      const repo = resolveRepoPath(typeof values.repo === "string" ? values.repo : undefined);
      const labels = listToolsSources(repo);
      console.log(labels.length ? labels.join("\n") : "(no tool snapshots)");
      return;
    }
    default:
      fail(`unknown tools action: ${action}`);
  }
}

main(process.argv.slice(2));
