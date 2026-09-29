#!/usr/bin/env bash
# SessionStart hook (matcher: compact) — put the session's /tack:note notes back
# in context once the conversation has been summarized ([HOOK-11]). The summary
# is free to drop a one-line aside; the transcript it was made from still holds
# every note verbatim.
#
# Stdin: JSON with "transcript_path".
# Stdout: the notes, injected as context for the agent. Nothing when there are none.

set -euo pipefail

input=$(cat)
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

notes=$(bash "$(dirname "${BASH_SOURCE[0]}")/../scripts/notes.sh" "$transcript")
[ -n "$notes" ] || exit 0

printf 'Notes the user took this session with /tack:note, restored after compaction. They are for the user to revisit; do not act on them unless asked:\n%s\n' "$notes"
