<p align="center">
  <img src="hero.svg" alt="tack — route tracker for ai-assisted development" width="800">
</p>

Route tracker for AI-assisted development.

tack captures the non-linear reality of how development actually happens — pivots, context switches, multi-repo changes — so that work-in-progress survives context exhaustion, crashes, and session boundaries.

## Quick Start

```bash
tack init auth-rewrite

tack add auth-rewrite "Replace session middleware"
tack add auth-rewrite "Update client SDK" --depends-on t1

tack before auth-rewrite t1 "Read compliance requirements"
tack start auth-rewrite t1

tack deliverable auth-rewrite t1 "Session middleware PR" https://github.com/org/api-server/pull/42
tack done auth-rewrite t1

tack status auth-rewrite
```

## Data Model

```text
Route (1 YAML file per route)
├── id (UUID), slug, created_at, updated_at
├── depends_on: [route slugs]
└── tacks[]
    ├── id (t1, t2, ...), summary, status
    ├── done_at
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

## Design Principles

- **The schema is the product.** The CLI is a convenience wrapper. Any tool that reads/writes conforming YAML is a first-class citizen.
- **One file per route.** Easy to list, archive, delete, or version-control.
- **Flat over nested.** A tack is one unit of work with one deliverable. No sub-items.
- **Dependencies, not workflows.** Tacks declare what they depend on. No enforced state machine.
- **Local only.** No server, no sync, no cloud.
