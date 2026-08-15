#!/usr/bin/env bash
# PostToolUse(Bash) hook — when a CR description lands, prompt the handoff
# report rather than leaving it to recall.
#
# Writing the description is the moment the session first has a reviewable
# thing, and the moment the user needs one block: where it stands and what's
# owed. The `end` skill owns that block; the failure this hook removes is
# producing it only when the agent happens to remember to.
#
# Stdin: JSON with "tool_input.command", "session_id" fields.
# Stdout: reminder text, which reaches the agent as tool feedback.

set -euo pipefail

input=$(cat)
command_text=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)

[ -z "$command_text" ] && exit 0
[ -z "$session_id" ] && exit 0

has() { printf '%s' "$command_text" | grep -Fq -- "$1"; }

# The description write, per forge: `gh pr edit --body-file` on GitHub, a
# `description=@<file>` PUT on GitLab. Both are file-passed, which is what
# separates them from `gh issue create --body-file` and from a comment.
landing=0
if has "gh pr " && has "--body-file"; then landing=1; fi
if has "merge_requests" && has "description=@"; then landing=1; fi
[ "$landing" -eq 1 ] || exit 0

# Once per session, and only charged when the nudge actually fires — a session
# that revises the description twice is still at one handoff point.
nudge_dir="${TMPDIR:-/tmp}/tack-landing-nudge"
mkdir -p "$nudge_dir"
nudge_file="${nudge_dir}/${session_id}"
[ -f "$nudge_file" ] && exit 0
touch "$nudge_file"

cat <<'EOF'
A CR description just landed, so the session is at a handoff point.

Once the CR reporting is done, close the turn with one table in the `end`
skill's shape rather than a prose recap: a `change | state | next` row per thing
to act on, with `next` carrying the commands in the order they run, then the
bold-labelled `route` / `retro` / `notes` footer. Step 5 of that skill is the
spec. This is a preview of the close, not the close — `/tack:end` still records
the deliverable on the route and hands off the retro.
EOF
