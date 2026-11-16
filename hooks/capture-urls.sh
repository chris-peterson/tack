#!/usr/bin/env bash
# PostToolUse hook for Bash — detects PR/MR/issue URLs in command output and,
# for any the store doesn't already track, nudges the agent to record it on the
# active route, with the commands that do it.
#
# Two sources feed it. A sibling plugin's announcement names the artifact
# outright (the suite's interop contract, in the marketplace repo at
# `authoring/plugin-contract.md`) — a change request from `cr.created` /
# `cr.updated`, an issue from `issue.created` — and the URL scrape finds one
# whatever produced it. Neither subsumes the other: the announcement is seen
# on any forge host, including a self-hosted one the scrape's pattern doesn't
# recognize, while the scrape is what catches a `gh pr view`, a paste, or a
# script that announces nothing.
#
# Reads the tool result JSON from stdin. Outputs the reminder as
# additionalContext JSON if an untracked PR/MR/issue URL is found.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib-url.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib-subscribe.sh"

input=$(cat)

# PostToolUse stdin shape: {"tool_name":"Bash","tool_input":{...},"tool_response":{"stdout":"..."}}
output=$(echo "$input" | jq -r '.tool_response.stdout // empty' 2>/dev/null)
[ -z "$output" ] && exit 0
cwd=$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
output=$(heard "$cwd" "$output")

# Announced URLs first, so they win the shared cap when one output carries both
# an announcement and a URL the scrape also matches. url_nudges_for dedupes, so
# a URL in both sources is nudged once.
announced=$(announced_trackable_urls "$output")
candidates=$(printf '%s\n%s' \
  "$announced" \
  "$(grep -oE "$URL_PATTERN" <<<"$output" || true)")

# `%s`, not `%b`: the nudge carries a URL harvested from tool output, and `%b`
# would expand a backslash escape inside it into real newlines — letting
# untrusted text forge its own lines in the context this stdout becomes.
nudges=$(url_nudges_for "$candidates" "PR/MR/issue URL in tool output:")
[ -n "$nudges" ] || exit 0

# The switch covers the announcements only; a URL the scrape found nudges
# whatever it is set to, so it is named only when an announcement contributed.
hint=""
[ -n "$announced" ] && hint=$(switch_hint anchor cr.created issue.created)
emit_context "${nudges}${hint:+$'\n\n'$hint}"
exit 0
