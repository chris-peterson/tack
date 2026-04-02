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
    output="${output}PR/MR URL detected in user message: ${url} — use \`tack deliverable\` to record it on the active route, or \`tack link\` if it's a reference.\n"
  done
fi

# --- 2. Session nudge (once per session) ---
nudge_dir="${TMPDIR:-/tmp}/tack-nudge"
mkdir -p "$nudge_dir"
nudge_file="${nudge_dir}/${session_id}"

if [ ! -f "$nudge_file" ] && command -v tack >/dev/null 2>&1; then
  touch "$nudge_file"

  # Try to match a route to the current git branch
  branch=""
  if [ -n "$cwd" ] && [ -d "$cwd/.git" ]; then
    branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  fi

  has_route=false
  if [ -n "$branch" ]; then
    tack_dir="${TACK_HOME:-$HOME/.tack}/routes"
    if [ -d "$tack_dir" ]; then
      # Check if any route slug matches the branch name
      for f in "$tack_dir"/*.yaml; do
        [ -f "$f" ] || continue
        slug=$(basename "$f" .yaml)
        if [ "$slug" = "$branch" ]; then
          has_route=true
          break
        fi
      done
      # Also check if any route has an in_progress tack
      if [ "$has_route" = false ]; then
        for f in "$tack_dir"/*.yaml; do
          [ -f "$f" ] || continue
          if grep -q 'status: in_progress' "$f" 2>/dev/null; then
            has_route=true
            break
          fi
        done
      fi
    fi
  fi

  if [ "$has_route" = false ]; then
    output="${output}No tack route is active for this session. Consider running \`tack init <slug>\` to track this work.\n"
  fi
fi

# Only emit output if we have something to say
if [ -n "$output" ]; then
  printf '%b' "$output"
fi
