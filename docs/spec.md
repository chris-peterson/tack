# Specification

tack v1 is a tool-agnostic route schema with a deterministic CLI and a
Claude Code plugin that layers reasoning on top.

> [!TIP]
> View the full spec source: [spec/v1/SPEC.md](https://github.com/chris-peterson/tack/blob/main/spec/v1/SPEC.md)

## Architecture

```mermaid
%%{ init: { 'look': 'handDrawn' } }%%
flowchart LR
    subgraph deterministic ["Deterministic"]
        cli["tack CLI"]
        schema["~/.tack/routes/*.yaml"]
        cli --> schema
    end

    subgraph plugin ["Claude Code plugin"]
        hooks["hooks"]
        skill["tack skill"]
        hooks --> skill
    end

    skill --> cli
```

The CLI and YAML schema are the durable, tool-agnostic layer — the CLI does
nothing beyond schema CRUD. The plugin is the Claude-Code-specific surface
that picks the active route, captures URLs, and resolves ambiguity by
prompting the user. Other agents or tools can target the same schema by
speaking to the CLI directly.

## Data Model

```text
Route (1 YAML file per route)
├── id (UUID), slug, created_at, updated_at
├── group (optional grouping slug)
├── depends_on: [route slugs]
├── sessions[]
│   └── id, started_at
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

## Requirement Categories

| Category | Description |
|---|---|
| RT | Route schema structure and constraints |
| TK | Tack fields, statuses, and ID sequencing |
| DV | Deliverable (single change request per tack) |
| TD | Todo items (before/after arrays with IDs) |
| DP | Dependency tracking and enforcement |
| LK | Link structure (label + url) |
| ST | Storage location, directory creation, validation, cwd pointer file |
| CL | CLI commands and output behavior |
| AG | Claude Code agent integration (skill responsibilities) |
| HK | Hook responsibilities (nudges, freshness checks) |

## Anti-Requirements

Explicitly out of scope:

- No project management (sprints, epics, story points)
- No time tracking
- No git operations
- No enforced workflows beyond dependency constraints
- No server, sync, or cloud
- No cross-route dependency enforcement
