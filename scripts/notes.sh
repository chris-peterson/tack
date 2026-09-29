#!/usr/bin/env bash
# Print the notes a session took with /tack:note, oldest first, one "- " bullet
# each ([NOTE-03]). Nothing is stored: the transcript already holds each note
# verbatim as the harness recorded the user's command-args, which is a better
# record than anything the agent could write back.
#
# Usage: notes.sh <transcript.jsonl>
#        notes.sh --session <session-id>   # finds the transcript under ~/.claude/projects
#
# Only the user's own prompts count. A tool result is a `user` entry too, and one
# whose output quoted the command tags would otherwise forge a note; skill bodies
# arrive as `isMeta` entries and the compaction summary as `isCompactSummary`.

set -euo pipefail

if [ "${1:-}" = "--session" ]; then
  session_id="${2:?usage: notes.sh --session <session-id>}"
  if ! printf '%s' "$session_id" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then
    echo "notes.sh: invalid session id: $session_id" >&2
    exit 2
  fi
  projects="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
  transcript=$(find "$projects" -name "${session_id}.jsonl" -not -path '*/subagents/*' -print -quit)
  if [ -z "$transcript" ]; then
    echo "notes.sh: no transcript for session $session_id under $projects" >&2
    exit 1
  fi
else
  transcript="${1:?usage: notes.sh <transcript.jsonl> | --session <session-id>}"
fi

[ -f "$transcript" ] || { echo "notes.sh: no such transcript: $transcript" >&2; exit 1; }

# `fromjson?` skips a line the harness is still appending.
jq -R -r '
  fromjson?
  | select(.type == "user" and (.isMeta | not) and (.isCompactSummary | not) and (.isSidechain | not))
  | .message.content
  | if type == "string" then . else ([.[]? | select(.type == "text") | .text] | join("\n")) end
  | select(test("<command-name>/tack:note</command-name>"))
  | (capture("<command-args>(?<args>[\\s\\S]*?)</command-args>").args // "")
  | gsub("^\\s+|\\s+$"; "")
  | select(length > 0)
  | "- " + gsub("\n"; "\n  ")
' "$transcript"
