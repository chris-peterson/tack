#!/usr/bin/env bash
# PostToolUse(Bash) hook — when a change request becomes reviewable, prompt the
# handoff report rather than leaving it to recall.
#
# That moment is when the session first has a reviewable thing, and when the
# user needs one block: where it stands and what's owed. The `end` skill owns
# that block; the failure this hook removes is producing it only when the agent
# happens to remember to.
#
# Stdin: JSON with "tool_response.stdout" and "session_id".
# Stdout: reminder text, which reaches the agent as tool feedback.

set -euo pipefail

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
[ -z "$session_id" ] && exit 0

# anchor saying it opened or changed a change request. The suite's plugins
# collaborate by printing one self-contained line on stdout, which reaches this
# hook as `tool_response.stdout`; anchor declares both events in its own
# `plugin.yml` and the format is the contract's:
# https://github.com/chris-peterson/claude-marketplace/blob/main/authoring/plugin-contract.md
#
# Both keys, because a run announces one or the other and never both: a fresh CR
# reports `cr.created` and only a pre-existing one reports `cr.updated`. Either
# is the handoff point, so matching `cr.updated` alone would take the nudge out
# for every new CR, which is the common case.
#
# Matching what anchor *says* rather than the shape of the command it ran is
# what lets anchor change forge CLIs or rename a flag without silently taking
# this nudge out. The body is not read here — that a CR is reviewable is the
# whole signal, and the fields belong to whoever records it.
output=$(printf '%s' "$input" | jq -r '.tool_response.stdout // empty' 2>/dev/null || true)
printf '%s' "$output" | grep -qE '^codes\.bridgeai\.anchor/cr\.(created|updated)[[:space:]]' || exit 0

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
