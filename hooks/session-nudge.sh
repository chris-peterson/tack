#!/usr/bin/env bash
# UserPromptSubmit hook — two responsibilities:
#   1. Detect PR/MR/issue URLs pasted by the user that no tack tracks yet, and
#      nudge the agent to ensure a route/tack mapping exists.
#   2. On the first message of a session, resolve the tack route for the current
#      repo/branch. If one exists, record the session on it; if not, nudge.
#
# Stdin: JSON with "prompt", "cwd", "session_id" fields.
# Stdout: reminder text (injected as system context for the agent).

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib-url.sh"

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // empty' 2>/dev/null)
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)
session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)

[ -z "$prompt" ] && exit 0

output=""

# --- 1. URL detection ---
output="${output}$(url_nudges "$prompt" "PR/MR/issue URL in user message:")"

# --- 2. Session nudge (once per session) ---
nudge_dir="${TMPDIR:-/tmp}/tack-nudge"
mkdir -p "$nudge_dir"
nudge_file="${nudge_dir}/${session_id}"

if [ ! -f "$nudge_file" ] && command -v tack >/dev/null 2>&1; then
  touch "$nudge_file"

  resolved_slug=""

  # Step 1: pin recorded for cwd (stored in ~/.tack/pins.yaml; `tack pin` with
  # no slug prints "<slug> (pinned …)" and exits 0 when a pin exists, else exits
  # 1). Gate on the exit code — the no-pin case still writes a line to stdout.
  if [ -n "$cwd" ]; then
    if pin_line=$(cd "$cwd" && tack pin 2>/dev/null); then
      resolved_slug=$(printf '%s' "$pin_line" | awk '{print $1}')
    fi
  fi

  # Step 2: branch slug matches a route
  if [ -z "$resolved_slug" ] && [ -n "$cwd" ] && [ -d "$cwd/.git" ]; then
    branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    if [ -n "$branch" ]; then
      tack_dir="${TACK_HOME:-$HOME/.tack}/routes"
      if [ -f "$tack_dir/$branch.yaml" ]; then
        resolved_slug="$branch"
      fi
    fi
  fi

  if [ -n "$resolved_slug" ]; then
    # Deterministically register this session on the resolved route, so fleet
    # views attribute it even when the agent never runs `tack session`. This is
    # route-level only — binding the specific tack stays the agent's judgment
    # call (it knows which of the route's tacks this session is driving). The
    # `|| true` keeps a tack write failure from ever breaking the user's prompt.
    if [ -n "$session_id" ]; then
      tack session "$resolved_slug" "$session_id" >/dev/null 2>&1 || true
    fi
  else
    output="${output}No tack route resolves for this cwd (no pin, no branch-slug match). Use the tack skill to identify or create a route for this work — the skill owns route resolution and will prompt if needed.\n"
  fi
fi

# Only emit output if we have something to say
if [ -n "$output" ]; then
  printf '%b' "$output"
fi
