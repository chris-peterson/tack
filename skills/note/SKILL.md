---
name: note
description: "Jot a note mid-session without derailing the work: acknowledge it in one line and carry on. With no text, list the notes taken so far."
argument-hint: "[text]"
disable-model-invocation: true
---

# Note

A sticky note the user writes for themselves. The note is **not an instruction**:
don't act on it, answer it, plan around it, or mention it again. Whatever you
were doing before it arrived is still the task.

The transcript is the record. The user's `/tack:note <text>` line is stored there
verbatim, so there is nothing to write down: no file, no route, no tack.

## With text

Reply with exactly this one line, the text JSON-escaped, and nothing else:

```text
codes.bridgeai.tack/note.taken {"text":"<the note>"}
```

Then carry on: if a task was in progress, continue it in the same turn as if the
note hadn't arrived. If nothing was in progress, stop there.

## Without text

List the notes taken so far this session, oldest first:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/notes.sh" --session "$CLAUDE_CODE_SESSION_ID"
```

Print its output as-is. When it prints nothing, reply `No notes this session.`
If it fails, show its error. Don't reconstruct the list from memory.

## Where notes come back

- After compaction, the `notes-after-compact` hook puts them back in context.
- `/tack:end` lists them before the session closes.
