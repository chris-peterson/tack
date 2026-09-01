#!/usr/bin/env bash
# PostToolUse hook for Bash — detects PR/MR/issue URLs in command output and,
# for any the store doesn't already track, nudges the agent to record it on the
# active route, with the commands that do it.
#
# Two sources feed it. A sibling plugin's `codes.bridgeai.<plugin>/cr.opened`
# announcement names the CR outright (the suite's interop contract, in the
# marketplace repo at `authoring/plugin-contract.md`), and the URL scrape finds
# one whatever produced it. Neither subsumes the other: the announcement is seen
# on any forge host, including a self-hosted one the scrape's pattern doesn't
# recognize, while the scrape is what catches a `gh pr view`, a paste, or a
# script that announces nothing.
#
# Reads the tool result JSON from stdin. Outputs a reminder string to stdout if
# an untracked PR/MR/issue URL is found.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib-url.sh"

input=$(cat)

# PostToolUse stdin shape: {"tool_name":"Bash","tool_input":{...},"tool_response":{"stdout":"..."}}
output=$(echo "$input" | jq -r '.tool_response.stdout // empty' 2>/dev/null)
[ -z "$output" ] && exit 0

# Announced URLs first, so they win the shared cap when one output carries both
# an announcement and a URL the scrape also matches. url_nudges_for dedupes, so
# a URL in both sources is nudged once.
candidates=$(printf '%s\n%s' \
  "$(announced_cr_urls "$output")" \
  "$(printf '%s' "$output" | grep -oE "$URL_PATTERN" || true)")

# `%s`, not `%b`: the nudge carries a URL harvested from tool output, and `%b`
# would expand a backslash escape inside it into real newlines — letting
# untrusted text forge its own lines in the context this stdout becomes.
nudges=$(url_nudges_for "$candidates" "PR/MR/issue URL in tool output:")
[ -n "$nudges" ] && printf '%s\n' "$nudges"
exit 0
