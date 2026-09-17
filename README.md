# ocs — opencode session store tool

Inspect, export, fork, edit, and git-sync [opencode](https://opencode.ai) sessions
and tooling — from the command line, without opencode running.

Zero runtime dependencies. Requires Node ≥ 22.5 (`node:sqlite`) and git.

```bash
npm install && npm run build
npm link        # optional: exposes the `ocs` binary
```

## How it works (mechanism)

opencode keeps its entire session store in one SQLite database:

```
$XDG_DATA_HOME/opencode/opencode.db
├── session   one row per session (title, directory, cost/tokens, parent_id, …)
├── message   one row per message;  `data` column = JSON (role, agent, model, …)
├── part      one row per part;     `data` column = JSON (text, reasoning/CoT,
│             tool calls, step-finish cost, …)
└── todo      per-session todo list
```

Everything the TUI shows — the transcript, the agent's chain-of-thought, tool
calls — is just rows in these tables. `ocs` reads and writes them directly:

| Feature | Mechanism |
|---|---|
| **view** | `SELECT` joined by `session_id`, rendered as a transcript (`reasoning` parts = agent CoT) |
| **export** | dump a session's rows to git-friendly JSON files + a Markdown transcript |
| **fork** | copy session/message/part rows under freshly generated opencode-style ids (`ses_/msg_/prt_` + hex timestamp + random suffix, so ids sort chronologically); `parentID` links inside message JSON are remapped to the new ids |
| **edit** | `UPDATE` the JSON `data` of a part/message — CoT editing = rewriting a `reasoning` part's `text` |
| **sync** | export into a git repo (`sessions/<id>/…`), commit, push/pull; import on the other machine = insert missing rows |
| **tools sync** | copy `.opencode`/`~/.config/opencode` into the repo; `node_modules` goes in as a `.tar.gz` for exact restore |
| **credentials** | endpoint + ssh-key/token stored in ocs's own `0600` config and injected per git command (`GIT_SSH_COMMAND` / `http.extraHeader`) — never written into any repo |

Read commands open the database **read-only**. Write commands (`fork`, `edit`,
`import`, `sync pull`) open it writable — close opencode first (or at least
don't run a session you're modifying).

### Fork vs. opencode's built-in fork

opencode has its own fork (`POST /session/:id/fork {messageID?}`, TUI branch
button). Ours matches its mechanism (row copy with fresh ascending ids,
optional truncation at a message) and differs deliberately where the built-in
one falls short:

| | opencode fork | ocs fork |
|---|---|---|
| truncate at message | ✅ `messageID` | ✅ `--at <messageId>` |
| lineage (`parent_id`) | ❌ not set | ✅ points at source |
| cost double-count ([issue #31032](https://github.com/anomalyco/opencode/issues/31032)) | ❌ open bug | ✅ cloned `step-finish` cost/tokens zeroed; fork starts at $0 |
| forks the working directory | ❌ | ✅ `--worktree` → git branch + worktree, session repointed |
| works while opencode is offline | — | ✅ (it is offline-only) |
| fork travels to other machines | ❌ | ✅ via `ocs sync` |

## Commands

### View — no opencode needed

```bash
ocs ls [--query text] [--limit n] [--archived]
ocs show <session> [--no-reasoning] [--no-tools] [--max-chars n]
```

`<session>` accepts a full id, a unique prefix, or a slug.

### Export / import

```bash
ocs export <session|all> [--out dir]
ocs import <dir> [--overwrite]
```

```
sessions/<id>/session.json    session row
sessions/<id>/messages.json   [{message, parts}] in order
sessions/<id>/todos.json
sessions/<id>/transcript.md   human-readable
```

### Fork

```bash
ocs fork <session> [--title t] [--at <messageId>] [--worktree [--worktree-dir d]]
```

`--worktree` forks the working directory too: creates git branch `ocs/<id>`
plus a worktree, and points the forked session at it — the git-style
"branch the code and the conversation together" workflow.

### Edit — including agent chain-of-thought

```bash
ocs edit title <session> <title>
ocs edit part-text <partId> (--text t | --file f)   # rewrite text/reasoning (CoT)
ocs edit replace <partId> <find> <replace>          # find/replace inside a part
ocs edit part-json <partId> --file f                # replace whole part payload
ocs edit message-json <messageId> --file f
ocs edit append <session> <text>                    # append a user message
ocs edit rm-message <messageId> | rm-part <partId>
ocs edit archive <session> [--un]
```

Find part/message ids in `ocs show` headers (truncated to 16 chars) or full
ids in `ocs export` output.

### Git sync — sessions via GitHub or any remote

```bash
ocs sync init [--repo r] --endpoint <git url> [--name n] [--ssh-key path | --token pat] [--create]
ocs sync push [--repo r] [--session id]... [--no-push]
ocs sync pull [--repo r] [--overwrite] [--no-pull]
ocs sync status [--repo r]
```

You only provide an **endpoint**, a **repo name**, and **one credential**.
`sync init` verifies git, probes the endpoint (`git ls-remote`), optionally
creates a **private** GitHub repo via API (`--create`, needs https + PAT),
wires `origin`, and saves config to `$XDG_CONFIG_HOME/ocs/config.json`
(mode `0600`). After that, `push`/`pull` pick up credentials automatically.

git is not bundled (platform bloat; pure-JS alternatives lack SSH) — a system
git on `PATH` is required and detected at init.

### Tools/plugins sync — including node_modules

```bash
ocs tools push [--repo r] [--from dir] [--as label]   # default: ~/.config/opencode as "global"
ocs tools list [--repo r]
ocs tools pull [--repo r] <label> [--to dir]
```

opencode's plugin dependency management is unreliable, so instead of trusting
`npm install` on the target machine, `node_modules` is archived into the repo
as `node_modules.tar.gz` and restored byte-for-byte. `.git` and the
`node_modules` tree are excluded from the plain file copy.

## Environment

| Variable     | Default                                   | Meaning            |
|--------------|-------------------------------------------|--------------------|
| `OCS_DB`     | `$XDG_DATA_HOME/opencode/opencode.db`     | session store path |
| `OCS_REPO`   | `$XDG_DATA_HOME/ocs/repo`                 | sync repo path     |
| `OCS_CONFIG` | `$XDG_CONFIG_HOME/ocs/config.json`        | ocs config (creds) |

## Development

```bash
npm test        # build + node --test (temp sqlite fixtures, never touches a real db)
```

| Module             | Responsibility                                     |
|--------------------|----------------------------------------------------|
| `src/db.ts`        | locate/open the SQLite store                       |
| `src/ids.ts`       | opencode-style order-preserving id generator       |
| `src/store.ts`     | typed CRUD over session/message/part/todo          |
| `src/view.ts`      | `ls` table + transcript rendering                  |
| `src/exporter.ts`  | export/import session directories                  |
| `src/fork.ts`      | session fork (+ optional git worktree fork)        |
| `src/edit.ts`      | surgical edits incl. CoT rewriting                 |
| `src/gitsync.ts`   | git repo push/pull + credential injection          |
| `src/syncinit.ts`  | `sync init`: endpoint probe, GitHub repo creation  |
| `src/config.ts`    | ocs-owned `0600` config (endpoint + credentials)   |
| `src/toolssync.ts` | tooling + node_modules sync                        |
| `src/cli.ts`       | arg parsing / command dispatch                     |

## Safety

- Read commands (`ls`, `show`, `export`, `sync status`) never modify the database.
- Write commands modify opencode's live store; run them with opencode closed.
- Exports contain full transcripts **including agent reasoning** — sync only to
  private repos.

License: MIT
