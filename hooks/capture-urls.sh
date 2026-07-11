#!/usr/bin/env bash
# DOCUMENTATION: Detects PR/MR/issue URLs in Bash tool output and nudges the agent to ensure a tack route mapping exists for each.
# PostToolUse hook for Bash — detects PR/MR/issue URLs in command output and,
# for any the store doesn't already track, nudges the agent to ensure a
# route/tack mapping exists via the tack skill.
#
# Reads the tool result JSON from stdin. Outputs a reminder string to stdout if
# an untracked PR/MR/issue URL is found.

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib-url.sh"

input=$(cat)

# PostToolUse stdin shape: {"tool_name":"Bash","tool_input":{...},"tool_response":{"stdout":"..."}}
output=$(echo "$input" | jq -r '.tool_response.stdout // empty' 2>/dev/null)
[ -z "$output" ] && exit 0

nudges=$(url_nudges "$output" "PR/MR/issue URL in tool output:")
[ -n "$nudges" ] && printf '%b' "$nudges"
exit 0
