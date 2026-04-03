# CLI Reference

## Routes

### `tack init <slug>`

Create a new route.

```bash
tack init auth-rewrite
```

### `tack status [slug]`

Show route details. Without a slug, shows a summary of all routes.

```bash
tack status auth-rewrite
tack status
```

### `tack list`

List all routes with open/total tack counts.

```bash
tack list
```

### `tack tree [path] [-d <depth>]`

Browse routes and tacks as a navigable tree. Paths use `/`-separated segments
with progressive drill-down. Supports glob wildcards (`*`, `?`) for querying
across routes and tacks.

**Depth levels:** 1 = routes only (default), 2 = routes + tacks, 3 = full details.

```bash
# Browse all routes
tack tree

# Drill into a route
tack tree auth-rewrite

# Drill into a tack
tack tree auth-rewrite/t1

# Drill into an aspect
tack tree auth-rewrite/t1/deliverable

# Expand all routes with tacks
tack tree -d 2

# Full detail on everything
tack tree -d 3
```

**Glob queries** (quote the path to prevent shell expansion):

```bash
# All deliverables (** matches across levels)
tack tree '**/deliverable'

# Everything under a route
tack tree 'ai-sdlc/**'

# All t1 tacks
tack tree '*/t1'

# Deliverables in routes matching a prefix
tack tree 'vault-*/*/deliverable'

# All dependency chains
tack tree '**/depends_on'

# Routes matching a pattern
tack tree 'fix-*'
```

`*` matches within a single path segment, `**` matches across segment
boundaries, `?` matches a single character.

**Tab completion** resolves each level progressively — routes append `/` so you
can keep drilling without retyping.

### `tack rm <slug> [--force]`

Delete a route. Requires `--force` to confirm.

```bash
tack rm auth-rewrite --force
```

## Tacks

### `tack add <slug> <summary> [options]`

Add a tack to a route.

| Option | Description |
|---|---|
| `--depends-on <id,...>` | Comma-separated tack IDs this depends on |

```bash
tack add auth-rewrite "Replace session middleware"
tack add auth-rewrite "Update SDK" --depends-on t1
```

### `tack start <slug> <tack-id>`

Start a tack. Fails if dependencies are unmet.

```bash
tack start auth-rewrite t1
```

### `tack done <slug> <tack-id>`

Complete a tack. Shows pending after-todos if any exist.

```bash
tack done auth-rewrite t1
```

### `tack drop <slug> <tack-id>`

Drop a tack.

```bash
tack drop auth-rewrite t2
```

## Deliverable

### `tack deliverable <slug> <tack-id> <label> <url>`

Set the change request for a tack.

```bash
tack deliverable auth-rewrite t1 "Session PR" https://github.com/org/repo/pull/42
```

## Todos

### `tack before <slug> <tack-id> <text>`

Add a pre-work todo.

```bash
tack before auth-rewrite t1 "Read compliance requirements"
```

### `tack after <slug> <tack-id> <text>`

Add a post-work todo.

```bash
tack after auth-rewrite t1 "Notify security team"
```

### `tack todo done <slug> <tack-id> <todo-id>`

Complete a todo item.

```bash
tack todo done auth-rewrite t1 b1
```

### `tack todo drop <slug> <tack-id> <todo-id>`

Remove a todo item.

```bash
tack todo drop auth-rewrite t1 a2
```

## Links

### `tack link <slug> <tack-id> <label> <url>`

Add a reference link to a tack.

```bash
tack link auth-rewrite t1 "Design doc" https://docs.example.com/auth
tack link auth-rewrite t1 "Slack thread" https://slack.com/archives/C123/p456
```
