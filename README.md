# ocs — opencode session store tool

Inspect, export, fork, edit, and git-sync [opencode](https://opencode.ai) sessions
and tooling from the command line. Zero runtime dependencies (Node ≥ 22.5,
uses `node:sqlite`).

opencode stores sessions in a SQLite database
(`$XDG_DATA_HOME/opencode/opencode.db`, tables `session` / `message` / `part` /
`todo`, JSON payloads in `data` columns). `ocs` works directly against that
store — read-only unless the command explicitly writes.

## Install

```bash
npm install
npm run build
npm link        # exposes the `ocs` binary (optional)
```

## Commands

### View (`ls`-style, no opencode needed)

```bash
ocs ls [--query text] [--limit n] [--archived]
ocs show <session> [--no-reasoning] [--no-tools] [--max-chars n]
```

`<session>` accepts a full id, a unique id prefix, or a slug.

### Export / import

```bash
ocs export <session|all> [--out dir]
ocs import <dir> [--overwrite]
```

Export layout (git-friendly, one dir per session):

```
sessions/<id>/session.json    session row
sessions/<id>/messages.json   [{message, parts}] in order
sessions/<id>/todos.json      todos
sessions/<id>/transcript.md   human-readable rendering
```

### Fork

```bash
ocs fork <session> [--title t] [--at <messageId>] [--worktree [--worktree-dir d]]
```

Creates a new session with `parent_id` pointing at the source; messages and
parts are copied under freshly generated opencode-style ids (order-preserving,
`parentID` links remapped). `--at` forks only the history up to a message.
`--worktree` additionally forks the working directory: creates a git branch
`ocs/<id>` plus a worktree, and points the forked session at it.

### Edit (including agent chain-of-thought)

```bash
ocs edit title <session> <title>
ocs edit part-text <partId> (--text t | --file f)   # rewrite text/reasoning (CoT)
ocs edit replace <partId> <find> <replace>          # find/replace inside a part
ocs edit part-json <partId> --file f                # replace whole part payload
ocs edit message-json <messageId> --file f          # replace whole message payload
ocs edit append <session> <text>                    # append a user message
ocs edit rm-message <messageId> | rm-part <partId>
ocs edit archive <session> [--un]
```

Find part/message ids with `ocs show` (ids are truncated to 16 chars in the
transcript header; use `ocs export` for full ids).

### Git sync (sessions via GitHub or any remote)

```bash
ocs sync init [--repo r] --endpoint <git url> [--name n] [--ssh-key path | --token pat] [--create]
ocs sync push [--repo r] [--session id]... [--no-push]
ocs sync pull [--repo r] [--overwrite] [--no-pull]
ocs sync status [--repo r]
```

**Setup is ocs-owned:** you only provide a git endpoint, a repo name, and one
credential. `sync init` verifies git is installed, probes the endpoint
(`git ls-remote`), optionally creates the repo via the GitHub API
(`--create`, needs an https endpoint + PAT; repos are created **private**),
wires `origin`, and saves everything to ocs's own config
(`$XDG_CONFIG_HOME/ocs/config.json`, mode 0600).

Credentials are injected into git per command — never written into the sync
repo's `.git/config`:

- ssh key → `GIT_SSH_COMMAND="ssh -i <key> -o IdentitiesOnly=yes"`
- https token → `http.extraHeader=Authorization: Basic base64(x-access-token:<pat>)`

git itself is **not bundled** (platform-specific bloat; pure-JS alternatives
lack SSH support) — a system `git` on `PATH` is required and detected at init.

`push` exports sessions into a git repo (default `$XDG_DATA_HOME/ocs/repo`,
override with `OCS_REPO`), commits, and pushes when a remote is configured.
`pull` fetches from the remote and imports sessions missing locally.
Credentials saved by `sync init` are picked up automatically by both.

### Tools/plugins sync (including node_modules)

```bash
ocs tools push [--repo r] [--from dir] [--as label]   # default: ~/.config/opencode as "global"
ocs tools list [--repo r]
ocs tools pull [--repo r] <label> [--to dir]
```

Copies the tooling directory (plugins, agents, skills, package.json, lockfile)
into the repo under `tools/<label>/` and archives `node_modules` as
`node_modules.tar.gz` — opencode's own dependency management for plugin dirs
is unreliable, so an exact tarball restore beats reinstalling. `.git` and the
`node_modules` tree itself are excluded from the plain copy.

## Environment

| Variable  | Default                                        | Meaning              |
|-----------|------------------------------------------------|----------------------|
| `OCS_DB`  | `$XDG_DATA_HOME/opencode/opencode.db`          | session store path   |
| `OCS_REPO`| `$XDG_DATA_HOME/ocs/repo`                      | sync repo path       |
| `OCS_CONFIG` | `$XDG_CONFIG_HOME/ocs/config.json`          | ocs config (creds)   |

## Development

```bash
npm test        # build + node --test (temp sqlite fixtures, no real db touched)
```

Modules (each independently testable):

| Module           | Responsibility                                  |
|------------------|-------------------------------------------------|
| `src/db.ts`      | locate/open the SQLite store                    |
| `src/ids.ts`     | opencode-style order-preserving id generator    |
| `src/store.ts`   | typed CRUD over session/message/part/todo       |
| `src/view.ts`    | `ls` table + transcript rendering               |
| `src/exporter.ts`| export/import session directories               |
| `src/fork.ts`    | session fork (+ optional git worktree fork)     |
| `src/edit.ts`    | surgical edits incl. CoT rewriting              |
| `src/gitsync.ts` | git repo push/pull sync + credential injection       |
| `src/syncinit.ts`| `sync init`: endpoint probe, GitHub repo creation    |
| `src/config.ts`  | ocs-owned 0600 config (endpoint + credentials)       |
| `src/toolssync.ts` | tooling + node_modules sync                      |
| `src/cli.ts`     | arg parsing / command dispatch                  |

Warning: write commands modify opencode's live database. opencode should
ideally be closed (or at least not writing to the same session) while using
`ocs fork` / `ocs edit` / `ocs import` / `ocs sync pull`.

License: MIT
