<p align="center">
  <img src="assets/hero.svg" alt="tack — route tracker for AI-assisted development" width="800">
</p>

Route tracker for AI-assisted development work — pivots, deliverables, and dependencies — across session boundaries.

tack captures the non-linear reality of how development actually happens — pivots, context switches, multi-repo changes — so that work-in-progress survives context exhaustion, crashes, and session boundaries.

## Installation

```bash
claude plugin marketplace add chris-peterson/claude-marketplace
claude plugin install tack@chris-peterson
```

The plugin bundles the CLI. To make `tack` callable from any shell, run once:

```text
/tack:tack install-cli
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
tack add auth-rewrite "Replace session middleware" --project org/api-server
tack add auth-rewrite "Update client SDK" --project org/sdk --depends-on t1

# Track pre-work and post-work todos
tack before auth-rewrite t1 "Read compliance requirements"
tack after auth-rewrite t1 "Notify security team"

# Start working
tack todo done auth-rewrite t1 b1
tack start auth-rewrite t1

# Attach the deliverable (the change request)
tack deliverable auth-rewrite t1 "Session middleware PR" https://github.com/org/api-server/pull/42

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
├── group (optional grouping slug)
├── depends_on: [route slugs]
├── sessions[]
│   └── id, started_at, tacks[] — route-scoped tack IDs the session is driving
└── tacks[]
    ├── id (t1, t2, ...), summary, status
    ├── project, done_at
    ├── depends_on: [tack IDs]
    ├── deliverable — the change request
    │   └── label, url
    ├── before[] — pre-work todos
    │   └── id (b1, b2, ...), text, done, done_at
    ├── after[] — post-work todos
    │   └── id (a1, a2, ...), text, done, done_at
    └── links[] — references
        └── label, url
```

Routes are stored as YAML files in `~/.tack/routes/`.

## CLI Reference

| Command | Description |
|---|---|
| `tack init <slug> [--group <slug>]` | Create a new route |
| `tack group <slug> [<group>] [--clear]` | Set, change, clear, or print a route's group |
| `tack status [slug] [--all] [--json]` | Show route details (dropped tacks hidden unless `--all`) |
| `tack list [--json]` | List all routes with open/total counts |
| `tack recent [--count <n>] [--since <date>] [--json]` | List routes by most recently updated |
| `tack find <url> [--json]` | Find every tack referencing a URL, in any deliverable or link |
| `tack add <slug> <summary> [opts]` | Add a tack (`--depends-on`, `--deliverable <url>`, repeatable `--link "label,url"`) |
| `tack start <slug> <tack-id>` | Start a tack (checks dependencies) |
| `tack done <slug> <tack-id>` | Complete a tack |
| `tack drop <slug> <tack-id>` | Mark tack as dropped (preserved for history) |
| `tack remove <slug> <tack-id> [--force]` | Delete a tack (use `--force` to strip dependent refs) |
| `tack move <src-slug>/<tack-id> <dst-slug> [--include-dependents]` | Move a tack to another route, preserving metadata |
| `tack merge-routes <new-slug> <src-slug>... [--group <slug>] [--created-at <date>] [--break-deps]` | Fold whole routes into one new route; destination t-IDs land in chronological order |
| `tack deliverable <slug> <tack-id> <url> [--label <text>]` | Set the change request (label auto-derived from the url; `--label` overrides) |
| `tack deliverable rm <slug> <tack-id> [--to-link]` | Clear the deliverable, or `--to-link` to demote it into links |
| `tack before <slug> <tack-id> <text>` | Add a pre-work todo |
| `tack after <slug> <tack-id> <text>` | Add a post-work todo |
| `tack todo done <slug> <tack-id> <todo-id>` | Complete a todo |
| `tack todo rm <slug> <tack-id> <todo-id>` | Delete a todo |
| `tack link add <slug> <tack-id> <label> <url>` | Add a reference link |
| `tack link rm <slug> <tack-id> <url>` | Remove a reference link |
| `tack rm <slug> [--force]` | Delete an entire route |
| `tack pin [<slug>]` | Pin a route as active for the current directory (no slug prints the current pin) |
| `tack unpin` | Clear the pin for the current directory |
| `tack pins [--json]` | List every pin with its directory, slug, and timestamp (flags `[dangling]`/`[idle]`) |
| `tack pins prune` | Remove pins whose route or directory no longer exists |
| `tack install-cli [--dir <path>]` | Install `tack` wrapper on PATH + zsh completions (plugin install) |
| `tack completions zsh` | Install zsh completion script |

## Design Principles

- **The schema is the product.** The CLI is a convenience wrapper. Any tool that reads/writes conforming YAML is a first-class citizen.
- **One file per route.** Easy to list, archive, delete, or version-control.
- **Flat over nested.** A tack is one unit of work with one deliverable. No sub-items.
- **Dependencies, not workflows.** Tacks declare what they depend on. No enforced state machine.
- **Local only.** No server, no sync, no cloud.

## License

MIT
