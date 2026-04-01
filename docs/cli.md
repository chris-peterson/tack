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
| `--project <name>` | Repository or project identifier |
| `--depends-on <id,...>` | Comma-separated tack IDs this depends on |

```bash
tack add auth-rewrite "Replace session middleware" --project org/api-server
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
