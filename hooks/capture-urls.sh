#!/usr/bin/env bash
# PostToolUse hook for Bash — detects PR/MR URLs in command output
# and reminds the agent to record them via the tack skill.
#
# Reads the tool result JSON from stdin. Outputs a reminder string
# to stdout if a PR/MR URL is found.

set -euo pipefail

input=$(cat)

# Extract stdout from tool result
# PostToolUse stdin shape: {"tool_name":"Bash","tool_input":{...},"tool_result":{"stdout":"..."}}
output=$(echo "$input" | jq -r '.tool_result.stdout // empty' 2>/dev/null)
[ -z "$output" ] && exit 0

# Match GitHub PR or GitLab MR URLs
url=$(echo "$output" | grep -oE 'https://(github\.com/[^/]+/[^/]+/(pull|issues)|gitlab\.[^[:space:]]*/-/(merge_requests|issues))/[0-9]+' | head -1)
[ -z "$url" ] && exit 0

echo "A PR/MR URL appeared: $url — record it as a deliverable on the active tack."
