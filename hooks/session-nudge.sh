#!/usr/bin/env bash
# UserPromptSubmit hook — two responsibilities:
#   1. Detect PR/MR/issue URLs pasted by the user that no tack tracks yet, and
#      nudge the agent to ensure a route/tack mapping exists.
#   2. Resolve the tack route for the current repo/branch. If one exists, name it
#      and record the session on it; if not, recommend opening one.
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
# Command substitution eats the nudge's trailing newline, so put one back when
# there was anything to say — otherwise the route-resolution nudge below runs on
# from the end of the last URL line.
url_part=$(url_nudges "$prompt" "PR/MR/issue URL in user message:")
[ -n "$url_part" ] && output="${output}${url_part}"$'\n'

# --- 2. Route resolution, and the open-a-session nudge ---
state_dir="${TMPDIR:-/tmp}/tack-nudge"
mkdir -p "$state_dir"
bound_file="${state_dir}/${session_id}.bound"
nudged_file="${state_dir}/${session_id}.nudged"

if [ ! -f "$bound_file" ] && command -v tack >/dev/null 2>&1; then
  resolved_slug=""
  tack_dir="${TACK_HOME:-$HOME/.tack}/routes"

  # Resolution reads route filenames directly rather than shelling out to tack
  # per prompt: both steps are a filename test, and this runs on every prompt.
  toplevel=""
  if [ -n "$cwd" ]; then
    toplevel=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)
  fi

  # Step 1: the branch is named for a route. This is the path `/tack:start`
  # sets up, and it stays the most specific signal — one branch, one route.
  if [ -n "$toplevel" ]; then
    branch=$(git -C "$toplevel" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
    if [ -n "$branch" ] && [ -f "$tack_dir/$branch.yaml" ]; then
      resolved_slug="$branch"
    fi
  fi

  # Step 2: the project is named for a route. Plenty of repos carry one
  # long-lived route of the same name, so work sitting on the default branch —
  # where step 1 has nothing to match — still lands on it.
  if [ -z "$resolved_slug" ] && [ -n "$toplevel" ]; then
    project=$(basename "$toplevel")
    if [ -f "$tack_dir/$project.yaml" ]; then
      resolved_slug="$project"
    fi
  fi

  if [ -n "$resolved_slug" ]; then
    # Deterministically register this session on the resolved route, so fleet
    # views attribute it even when the agent never runs `tack session`. This is
    # route-level only — binding the specific tack stays the agent's judgment
    # call (it knows which of the route's tacks this session is driving). The
    # `|| true` keeps a tack write failure from ever breaking the user's prompt.
    if [ -n "$session_id" ]; then
      # TACK_ANNOUNCE=0: this bind cannot announce the session's start to
      # anyone. Its output is discarded just below, and a UserPromptSubmit
      # hook's stdout reaches the agent as context rather than as a Bash tool
      # response, which is the only thing a subscriber reads. Suppressing it
      # here leaves the announcement for the first bind the agent makes itself.
      TACK_ANNOUNCE=0 tack session "$resolved_slug" "$session_id" >/dev/null 2>&1 || true
      touch "$bound_file"
      # Naming the route is the whole reason the agent can answer "where was
      # I?" without being asked to go look. Once per session: the bound_file
      # above is what keeps this block from running again.
      output="${output}Tack route for this session: \`${resolved_slug}\` (recorded). \`tack tree ${resolved_slug}\` replays where the work stands. Once it is clear which tack this session drives, bind it: \`tack session ${resolved_slug} \$CLAUDE_CODE_SESSION_ID --tack <tack-id>\`. Route reasoning: ${TACK_GUIDE}
"
    fi
  elif [ ! -f "$nudged_file" ]; then
    touch "$nudged_file"
    # A prompt that already opens a session needs no recommendation to, and
    # outside a git repo there is no branch for a route to answer to.
    case "$prompt" in
      */start*) ;;
      *)
        if [ -n "$toplevel" ]; then
          # Real newlines rather than literal `\n`: this is printed with
          # `printf '%s'` so that the URL nudge above, which carries untrusted
          # text, cannot have escapes in it expanded.
          output="${output}No tack route resolves for this cwd (neither the branch nor the project name matches a route).

If this turns out to be work rather than a question — it will span turns and produce a deliverable — recommend the user run \`/tack:start [issue-url]\` before starting: it reads the linked thread in full, derives one slug, cuts the branch, and binds the route the work gets recorded against. \`/tack:end\` closes it.

For a one-off question, a read-only investigation, or a mechanical one-liner, say nothing about this.
"
        fi
        ;;
    esac
  fi
fi

# Only emit output if we have something to say
if [ -n "$output" ]; then
  printf '%s' "$output"
fi
