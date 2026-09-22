# tack

**tack** your progress across sessions.

![Claude Code](https://img.shields.io/badge/Claude%20Code-%23D97757.svg?logo=claudecode&logoColor=white)
![GitHub top language](https://img.shields.io/github/languages/top/chris-peterson/tack)
![GitHub Release](https://img.shields.io/github/v/release/chris-peterson/tack?sort=semver&display_name=release&logo=github&label=latest)

Route tracker for AI-assisted development work (pivots, deliverables and dependencies) across session boundaries.

tack captures the non-linear reality of how development actually happens — pivots, context switches, multi-repo changes — so that work-in-progress survives context exhaustion, crashes, and session boundaries.

## Installation

```bash
claude plugin marketplace add chris-peterson/claude-marketplace
claude plugin install tack@chris-peterson
```

The plugin bundles the CLI. To make `tack` callable from any shell, run once:

```text
/tack:install-tack
```

This drops a `tack` wrapper at `~/.local/bin/tack` (use `--dir <path>` to override) **and** installs the zsh completion script to `~/.zsh/completions/_tack`. Run `exec zsh` to pick up completions.

### Updating

Third-party Claude Code marketplaces have auto-update **off by default**. To stay current with new tack releases, either:

- **Enable auto-update once** via `/plugin` → Marketplaces → `chris-peterson` → Enable auto-update. Future releases install on the next session start.
- **Or update manually** with `claude plugin update tack@chris-peterson`.

Confirm what's installed: `tack --version`. See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## Quick Start

```bash
# Create a route
tack init auth-rewrite

# Add tacks (units of work)
tack add auth-rewrite "Replace session middleware"
tack add auth-rewrite "Update client SDK" --depends-on t1

# Start working
tack start auth-rewrite t1

# Attach the deliverable (the change request) — the label comes from the url
tack deliverable auth-rewrite t1 https://github.com/org/api-server/pull/42

# Add reference links
tack link add auth-rewrite t1 "Design doc" https://docs.example.com/auth-design

# Complete
tack done auth-rewrite t1

# Check status
tack status auth-rewrite
```

## Data Model

```
Route (1 YAML file per route)
├── id (UUID), slug, created_at, updated_at
├── title (optional display name), description (optional markdown)
├── group (optional grouping slug)
└── tacks[]
    ├── id (t1, t2, ...), summary, status
    ├── done_at
    ├── depends_on: [tack IDs, or <slug>/t<N> across routes]
    ├── deliverable — the change request
    │   └── label, url
    └── links[] — references (docs, issues, threads)
        └── label, url
```

```
Session (1 YAML file per session)
├── id — the Claude Code session identifier, and the filename
├── started_at, ended_at
├── routes[] — the routes it touched
└── tacks[] — the tacks it drove, as <slug>/t<N>
```

## Where routes are stored

Routes are YAML files under a store root, filed by the year each route was
opened in. Sessions sit beside them, one file each, named by the session id:

```
<root>/2026/routes/<slug>.yaml
<root>/2026/sessions/<session-id>.yaml
```

The root is `~/.tack` unless `TACK_HOME` names another directory. Lookups read
every year present, so a route that runs past New Year stays in the one file it
started in.

A session is its own document because it has no direct relationship with a
route. It produces however many tacks it produces — often none — and those
tacks land wherever they belong, which may be one route or several. So the
session file holds all of it: the routes it touched, the tacks it drove as
`<slug>/t<N>`, when it started, and — once `/tack:end` closes it — when it
declared itself finished. Nothing about a session is written to a route file,
which is what keeps the two from disagreeing.

A session earns its file by driving a tack. Opening a route and reading around
leaves nothing behind, which is the right record of a session that produced
nothing.

`tack sessions` lists them newest first; `tack status <slug>` shows the ones
that touched one route.

### Keeping the store in git

Point `TACK_HOME` at a checkout and the record becomes durable and auditable —
who changed what, and when — instead of living only on one machine:

```bash
export TACK_HOME="$HOME/src/<you>/tack.db"   # in ~/.zshenv, so hooks see it too
```

Create the repo, then work as usual; `tack init` makes the year directory on
first use. The CLI performs no git operations, so committing and pushing the
store is yours to do, on whatever rhythm suits you.

Moving an existing `~/.tack` into a store is a file move: place each
`routes/<slug>.yaml` under the year in its `created_at`.


## CLI Reference

| Command | Description |
|---|---|
| `tack init <slug> [--group <slug>]` | Create a new route |
| `tack group <slug> [<group>] [--clear]` | Set, change, clear, or print a route's group |
| `tack title <slug> [<text>] [--clear]` | Set, change, clear, or print a route's display name |
| `tack describe <slug> [<text>] [--file <path>] [--clear]` | Set, change, clear, or print a route's markdown description (`--file -` reads stdin) |
| `tack status [slug] [--all] [--json]` | Show route details (dropped tacks hidden unless `--all`) |
| `tack list [--json]` | List all routes with open/total counts |
| `tack recent [--count <n>] [--since <date>] [--json]` | List routes by most recently updated |
| `tack find --url <url> [--json]` | Find every tack referencing a URL, in any deliverable or link |
| `tack find --path [<dir>] [--json]` | Find routes covering a repo checkout (default cwd), via its origin remote |
| `tack add <slug> <summary> [opts]` | Add a tack (`--depends-on`, `--deliverable <url>`, repeatable `--link "label,url"`) |
| `tack start <slug> <tack-id>` | Start a tack (checks dependencies) |
| `tack done <slug> <tack-id>` | Complete a tack |
| `tack drop <slug> <tack-id>` | Mark tack as dropped (preserved for history) |
| `tack reconcile [slug] [--dry-run]` | Close every open tack whose deliverable has merged, stamped with the merge time — the one command that reaches out to the git forge (GitHub, GitLab), via your `gh` / `glab` login |
| `tack remove <slug> <tack-id> [--force]` | Delete a tack (use `--force` to strip dependent refs) |
| `tack move <src-slug>/<tack-id> <dst-slug> [--include-dependents]` | Move a tack to another route, preserving metadata |
| `tack merge-routes <new-slug> <src-slug>... [--group <slug>] [--created-at <date>] [--break-deps]` | Fold whole routes into one new route; destination t-IDs land in chronological order |
| `tack deliverable <slug> <tack-id> <url> [--label <text>]` | Set the change request (label auto-derived from the url; `--label` overrides) |
| `tack deliverable rm <slug> <tack-id> [--to-link]` | Clear the deliverable, or `--to-link` to demote it into links |
| `tack link add <slug> <tack-id> <label> <url>` | Add a reference link |
| `tack link rm <slug> <tack-id> <url>` | Remove a reference link |
| `tack rm <slug> [--force]` | Delete an entire route |
| `tack doctor [--json]` | Report route files that will not load, naming each file and the rule it breaks |
| `tack serve [--port <n>]` | Serve route documents at `http://127.0.0.1:8788/` — index, one route, one group; re-read from disk on every request. HTML or JSON by `Accept`; a route's title and description are editable from the page |
| `tack serve install\|uninstall\|status` | Manage an opt-in supervised server (launchd on macOS, systemd on Linux) |
| `tack install-cli [--dir <path>]` | Install `tack` wrapper on PATH + zsh completions (plugin install) |
| `tack completions zsh` | Install zsh completion script |

## Compatibility

Anything that reads the route files or shells out to `tack` is a first-class consumer, so `1.x` freezes what those consumers stand on:

| Frozen for `1.x` | Free to change |
|---|---|
| The route schema — field names, types, formats | Human-readable output text and layout |
| The CLI grammar — commands, subcommands, flags, positional order | Error and warning wording (the `tack:` prefix and non-zero exit stay) |
| Exit codes | `~/.tack/repos.yaml`, the CLI's own bookkeeping |
| `--json` output shapes | The Claude Code plugin's hook nudges and skill prose |

Frozen means additive-only: new optional fields, commands, flags, and `--json` keys arrive in minor releases, so tolerate keys you don't recognize. Removing or renaming anything above, or refusing input an earlier `1.x` accepted, waits for 2.0.

Compatibility runs one way. A release reads what earlier ones wrote, but the schema rejects fields it doesn't know, so downgrading after a newer release has written a field into your routes leaves them unreadable until you upgrade again.

Full contract: the COMPAT requirements in [`SPEC.md`](SPEC.md).

## Design Principles

- **The schema is the product.** The CLI is a convenience wrapper. Any tool that reads/writes conforming YAML is a first-class citizen.
- **One file per route.** Easy to list, archive, delete, or version-control.
- **Flat over nested.** A tack is one unit of work with one deliverable. No sub-items.
- **Dependencies, not workflows.** Tacks declare what they depend on. No enforced state machine. The skills that open and close a route ask before closing on work that isn't durable yet, and name the next commands rather than running them.
- **Records itself.** A tack is written as a side effect of the work, by hooks and skills and one-line commands. Nothing asks you to maintain a field by hand or revisit a tack to keep it true.
- **Not project management.** No sprints, points, backlogs, or planning state. A route says what is happening and what it depends on; what *should* happen next stays in whatever system you already run.
- **Local only.** No server, no sync, no cloud.

## Development

`just` is the front door: run it bare for the grouped list of every recipe.

```bash
git clone https://github.com/chris-peterson/tack
cd tack
just setup     # npm ci
just check     # reports every prerequisite and the recipes that want it
just test      # build, then the full suite
```

`just setup` is optional in practice: any recipe that compiles installs the
dependencies on a checkout that hasn't got `node_modules` yet. `just check` is
what to run when a recipe fails for a reason that isn't your code, since it
names the missing tool instead of leaving you to read a stack trace.

To run your working copy as the installed CLI, `just trial-on` puts it on your
PATH and `just trial-off` puts the published build back. `tack --version`
answers `<version>-dev.g<sha>` while you're trialling.

Build order, the CI gates, and how generated artifacts are projected are in
[`AGENTS.md`](AGENTS.md).

## License

MIT
