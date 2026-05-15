#!/usr/bin/env bash
# UserPromptSubmit hook — two responsibilities:
#   1. Detect PR/MR URLs pasted by the user and remind the agent to record them.
#   2. On the first message of a session, check whether a tack route exists
#      for the current repo/branch. If not, suggest using /recipe.
#
# Stdin: JSON with "prompt", "cwd", "session_id" fields.
# Stdout: reminder text (injected as system context for the agent).

set -euo pipefail

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // empty' 2>/dev/null)
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)
session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)

[ -z "$prompt" ] && exit 0

output=""

# --- 1. URL detection ---
urls=$(echo "$prompt" | grep -oE 'https://(github\.com/[^/]+/[^/]+/(pull|issues)|gitlab\.[^[:space:]]*/-/(merge_requests|issues))/[0-9]+' | head -3 || true)
if [ -n "$urls" ]; then
  for url in $urls; do
    output="${output}PR/MR/issue URL in user message: ${url} — use the tack skill to record it on the active route (deliverable for PR/MR, link otherwise). The skill owns route resolution.\n"
  done
fi

# --- 2. Session nudge (once per session) ---
nudge_dir="${TMPDIR:-/tmp}/tack-nudge"
mkdir -p "$nudge_dir"
nudge_file="${nudge_dir}/${session_id}"

if [ ! -f "$nudge_file" ] && command -v tack >/dev/null 2>&1; then
  touch "$nudge_file"

  has_route=false

  # Step 1: pin file at cwd
  if [ -n "$cwd" ] && [ -f "$cwd/.tack" ]; then
    has_route=true
  fi

  # Step 2: branch slug matches a route
  if [ "$has_route" = false ] && [ -n "$cwd" ] && [ -d "$cwd/.git" ]; then
    branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    if [ -n "$branch" ]; then
      tack_dir="${TACK_HOME:-$HOME/.tack}/routes"
      if [ -f "$tack_dir/$branch.yaml" ]; then
        has_route=true
      fi
    fi
  fi

  if [ "$has_route" = false ]; then
    output="${output}No tack route resolves for this cwd (no pin, no branch-slug match). Use the tack skill to identify or create a route for this work — the skill owns route resolution and will prompt if needed.\n"
  fi
fi

# Only emit output if we have something to say
if [ -n "$output" ]; then
  printf '%b' "$output"
fi
