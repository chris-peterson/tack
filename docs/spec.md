# Specification

The v1 spec defines 32 requirements across 8 categories:
**RT** (Route), **TK** (Tack), **DV** (Deliverable), **TD** (Todo),
**DP** (Dependencies), **LK** (Links), **ST** (Storage), **CL** (CLI).

> [!TIP]
> View the full spec source: [spec/v1/SPEC.md](https://github.com/chris-peterson/tack/blob/main/spec/v1/SPEC.md)

## Data Model

```text
Route (1 YAML file per route)
├── id (UUID), slug, created_at, updated_at
├── origin: planned | tangent
├── depends_on: [route slugs]
├── sessions[]
│   └── id, started_at
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

## Requirement Categories

| Category | ID Range | Description |
|---|---|---|
| RT | RT-01 to RT-10 | Route schema structure and constraints |
| TK | TK-01 to TK-07 | Tack fields, statuses, and ID sequencing |
| DV | DV-01 to DV-02 | Deliverable (single change request per tack) |
| TD | TD-01 to TD-05 | Todo items (before/after arrays with IDs) |
| DP | DP-01 to DP-04 | Dependency tracking and enforcement |
| LK | LK-01 | Link structure (label + url) |
| ST | ST-01 to ST-05 | Storage location, directory creation, validation |
| CL | CL-01 to CL-16 | CLI commands and output behavior |
| AG | AG-01 to AG-09 | Claude Code agent integration |

## Anti-Requirements

Explicitly out of scope:

- No project management (sprints, epics, story points)
- No time tracking
- No git operations
- No enforced workflows beyond dependency constraints
- No server, sync, or cloud
- No cross-route dependency enforcement
