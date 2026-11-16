#!/usr/bin/env bash
# Shared helpers for the PostToolUse hooks that react to a sibling's
# announcement (hooks/capture-urls.sh, hooks/landing-nudge.sh,
# hooks/record-landed.sh), which source this by relative path. Each one holds a
# rule of the suite's subscriber contract, cited by ID:
# https://github.com/chris-peterson/claude-marketplace/blob/main/SPEC.md
# Source this; don't execute it.

# heard <cwd> <text>
#
# <text> with every announcement line removed whose subscription the user has
# switched off (bridge.ai SWITCH-01..03, SWITCH-06). Two git config booleans
# turn a subscription off: `tack.subscribe.<publisher>` for everything that
# publisher announces, and `tack.subscribe.<publisher>.<entity>-<event>` for one
# key. Either reading `false` is off; anything else, unset included, is on.
#
# They are read in the repository the tool call ran in, so a repository's own
# value overrides the global one. Filtering the text rather than asking per
# reaction is what lets a hook that handles several keys honor each key's switch
# without knowing the rule.
#
# Only the announcement lines go. A URL the same output carries elsewhere is
# still the URL scrape's to find, because the scrape is not a subscription.
heard() {
  local cwd=$1 text=$2 key off=""
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    subscription_on "$cwd" "${key%%/*}" "${key#*/}" || off="${off:+$off|}${key//./\\.}"
  done <<EOF
$(grep -oE '^codes\.bridgeai\.[a-z0-9-]+/[a-z0-9_-]+\.[a-z0-9_-]+[[:space:]]' <<<"$text" \
  | sed -E 's/^codes\.bridgeai\.//; s/[[:space:]]$//' | sort -u)
EOF
  if [ -z "$off" ]; then
    printf '%s' "$text"
    return 0
  fi
  grep -vE "^codes\.bridgeai\.($off)[[:space:]]" <<<"$text" || true
}

# subscription_on <cwd> <publisher> <entity.event>
subscription_on() {
  local cwd=$1 publisher=$2 event=$3 name value
  for name in "tack.subscribe.${publisher}" "tack.subscribe.${publisher}.${event//./-}"; do
    value=$(git -C "$cwd" config --type=bool --get "$name" 2>/dev/null) || continue
    [ "$value" = false ] && return 1
  done
  return 0
}

# switch_hint <publisher> <entity.event>...
#
# The line a printed reaction ends with (bridge.ai SWITCH-04): the command that
# turns it off. One key names that key's switch; several from one hook name the
# publisher's, which is the one switch that covers them all.
switch_hint() {
  local publisher=$1 name
  shift
  if [ "$#" -eq 1 ]; then
    name="tack.subscribe.${publisher}.${1//./-}"
  else
    name="tack.subscribe.${publisher}"
  fi
  printf 'To turn this off: git config --global %s false' "$name"
}

# emit_context <text>
#
# Hand <text> to the agent (bridge.ai SUB-07). A PostToolUse hook's plain
# stdout reaches the transcript and never the agent, so a reaction printed raw
# is one nobody acts on.
emit_context() {
  jq -nc --arg m "$1" \
    '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}'
}
