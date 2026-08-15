#!/usr/bin/env bash
# UserPromptSubmit hook — two responsibilities:
#   1. Detect PR/MR/issue URLs pasted by the user that no tack tracks yet, and
#      nudge the agent to ensure a route/tack mapping exists.
#   2. Resolve the tack route for the current repo/branch. If one exists, record
#      the session on it; if not, recommend opening one.
#
# Resolution retries every prompt until it binds, rather than running once per
# session. A session that opens with `/tack:start` has no route at its first
# prompt — the skill creates one mid-turn — so a once-per-session probe would
# look before the route exists and never look again, leaving the session
# unattributed for its whole life. The nudge text is still once per session; only
# the resolution repeats.
#
# Stdin: JSON with "prompt", "cwd", "session_id" fields.
# Stdout: reminder text (injected as system context for the agent).

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib-url.sh"

input=$(cat)
prompt=$(echo "$input" | jq -r '.prompt // empty' 2>/dev/null)
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null)
session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)

[ -z "$prompt" ] && exit 0

output=""

# --- 1. URL detection ---
output="${output}$(url_nudges "$prompt" "PR/MR/issue URL in user message:")"

# --- 2. Route resolution, and the open-a-session nudge ---
state_dir="${TMPDIR:-/tmp}/tack-nudge"
mkdir -p "$state_dir"
bound_file="${state_dir}/${session_id}.bound"
nudged_file="${state_dir}/${session_id}.nudged"

if [ ! -f "$bound_file" ] && command -v tack >/dev/null 2>&1; then
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
      touch "$bound_file"
    fi
  elif [ ! -f "$nudged_file" ]; then
    touch "$nudged_file"
    # A prompt that already opens a session needs no recommendation to, and
    # outside a git repo there is no branch for a route to answer to.
    case "$prompt" in
      */start*) ;;
      *)
        if [ -n "$cwd" ] && [ -d "$cwd/.git" ]; then
          output="${output}No tack route resolves for this cwd (no pin, no branch-slug match).\n\nIf this turns out to be work rather than a question — it will span turns and produce a deliverable — recommend the user run \`/tack:start [issue-url]\` before starting: it reads the linked thread in full, derives one slug, cuts the branch, and binds the route the work gets recorded against. \`/tack:end\` closes it.\n\nFor a one-off question, a read-only investigation, or a mechanical one-liner, say nothing about this.\n"
        fi
        ;;
    esac
  fi
fi

# Only emit output if we have something to say
if [ -n "$output" ]; then
  printf '%b' "$output"
fi
