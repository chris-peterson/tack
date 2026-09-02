#!/usr/bin/env bash
# PostToolUse hook for Bash — acts on the two announcements that say work
# landed: a change request merged, and a release published.
#
# anchor used to write these onto the route itself, calling `tack done` and
# `tack deliverable` from its merge skill and `tack link add` from its release
# skill. Those calls named one consumer inside anchor's own flow and did nothing
# on a machine without tack, so they left when anchor started announcing the
# facts instead. Reacting here is what keeps a route closing itself on a merge.
#
# A merge is written rather than nudged for. The announced URI identifies the
# tack on its own — it is already recorded there as the CR's link — and
# `tack done` promotes that link to the deliverable, so the whole write is
# determined and needs no judgment from the agent. It is the same fact
# `tack reconcile` writes when it polls the forge, learned by announcement
# instead of by asking.
#
# Everything the announcement does not determine is reported for the agent
# instead: no tack holds the URL, several do, or a merge time that will not
# validate. A release is always reported, never written — which tack a release
# belongs to isn't in the announcement, and a release covers however many tacks
# shipped in it.
#
# Stdin: JSON with "tool_response.stdout".
# Stdout: what was written, or what the agent should record, as tool feedback.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib-url.sh"

input=$(cat)
output=$(printf '%s' "$input" | jq -r '.tool_response.stdout // empty' 2>/dev/null || true)
[ -z "$output" ] && exit 0

report=""

# The route bookkeeping needs the CLI. Without it there is nothing to write and
# nothing useful to say about what a route holds, so the announcement is named
# and the recording left to the agent.
have_tack=false
command -v tack >/dev/null 2>&1 && have_tack=true

# --- cr.merged: close the tack holding this CR ---
while IFS=$'\t' read -r uri merged_at; do
  [ -n "$uri" ] || continue
  announced_url_ok "$uri" || continue

  # Every command this hook prints for the agent to run carries the merge time,
  # so a value that won't validate becomes the placeholder rather than being
  # pasted into a command that would fail on it.
  if announced_date_ok "$merged_at"; then
    date_arg="$merged_at"
  else
    date_arg="<YYYY-MM-DD>"
  fi

  if [ "$have_tack" != true ]; then
    report="${report}anchor merged ${uri}. Close the tack holding it: \`tack done <slug> <tack-id> --date ${date_arg}\` (that promotes the CR link to the deliverable). Route reasoning: ${TACK_GUIDE}"$'\n'
    continue
  fi

  # `tack find --url` reports one match per deliverable or link, so a URL held
  # by one tack in two routes reads as two. Reduce to the distinct tacks before
  # deciding whether the write is unambiguous.
  matches=$(tack find --url "$uri" --json 2>/dev/null || true)
  pairs=$(printf '%s' "$matches" \
    | jq -r 'try ([.[] | "\(.slug)\t\(.tackId)\t\(.status)"] | unique | .[]) catch empty' 2>/dev/null \
    || true)
  count=$(printf '%s' "$pairs" | awk 'NF' | wc -l | tr -d ' ')

  if [ "$count" != 1 ]; then
    # Nothing holds it yet (the CR was never recorded), or more than one tack
    # does. Either way the agent picks the tack; naming the merge is the job.
    report="${report}anchor merged ${uri}, and ${count} tacks reference it. Record the merge on the right tack: \`tack done <slug> <tack-id> --date ${date_arg}\`. With none, \`tack add <slug> <summary> --done --date ${date_arg} --deliverable ${uri}\` backfills it. Route reasoning: ${TACK_GUIDE}"$'\n'
    continue
  fi

  slug=$(printf '%s' "$pairs" | awk -F'\t' 'NF{print $1; exit}')
  tack_id=$(printf '%s' "$pairs" | awk -F'\t' 'NF{print $2; exit}')
  status=$(printf '%s' "$pairs" | awk -F'\t' 'NF{print $3; exit}')

  case "$status" in
    done|dropped)
      # Already closed: a re-announcement of the same merge, or a tack someone
      # closed by hand. Writing again would move `done_at`.
      continue
      ;;
  esac

  if [ "$date_arg" != "$merged_at" ]; then
    # The merge time is written into a route file and read back as a timestamp.
    # A value that won't validate stops the write rather than being dropped
    # silently or replaced with "now", which would date the work to when tack
    # heard about it instead of when it happened.
    report="${report}anchor merged ${uri} (${slug}/${tack_id}), but announced no usable merge time. Close it with the forge's own timestamp: \`tack done ${slug} ${tack_id} --date ${date_arg}\`."$'\n'
    continue
  fi

  # `|| true` on the write itself, for the reason session-nudge has one: a tack
  # write that fails must not turn the command the user just ran into a failed
  # tool call. What it printed is reported either way.
  if written=$(tack 'done' "$slug" "$tack_id" --date "$merged_at" 2>&1); then
    report="${report}Recorded on the route: ${slug}/${tack_id} closed at ${merged_at}, ${uri} promoted to its deliverable (anchor announced the merge)."$'\n'
    # `tack done` reports pending post-work todos and an ambiguous promotion on
    # its own. Those are the user's to act on, so they travel with the report.
    case "$written" in
      *"Pending todo items:"*|*"Multiple PR/MR links"*)
        report="${report}${written}"$'\n'
        ;;
    esac
  else
    report="${report}anchor merged ${uri}, but \`tack done ${slug} ${tack_id} --date ${merged_at}\` failed: ${written}"$'\n'
  fi
done <<EOF
$(announced_merges "$output")
EOF

# --- release.created: attach the release to the tack that shipped ---
#
# Reported, never written. The announcement carries the release and its tag but
# nothing that says which tack shipped in it, and a release routinely covers
# several — so the tack is the agent's call, from the route it is working.
while IFS=$'\t' read -r uri tag; do
  [ -n "$uri" ] || continue
  announced_url_ok "$uri" || continue
  label="${tag:-release}"
  report="${report}anchor published ${label}: ${uri}. Attach it to the tack that shipped: \`tack link add <slug> <tack-id> ${label} ${uri}\`. Route reasoning: ${TACK_GUIDE}"$'\n'
done <<EOF
$(announced_releases "$output")
EOF

# `%s`, not `%b`: every line above carries a URI, a tag, or CLI output that came
# from tool output, and `%b` would expand a backslash escape inside one into
# real newlines — letting untrusted text forge its own lines in the context this
# stdout becomes.
[ -n "$report" ] && printf '%s' "$report"
exit 0
