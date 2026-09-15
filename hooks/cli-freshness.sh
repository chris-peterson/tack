#!/usr/bin/env bash
# SessionStart hook: report entry points a plugin update left behind.
#
# Claude Code updates the plugin in the background, so new code arrives with no
# action from the user — while the wrapper on $PATH keeps the path it baked at
# install time. Once the old version's directory is reaped that path reaches
# nothing.
#
# The check itself is the CLI's (`tack freshness`, HOOK-01), run from
# ${CLAUDE_PLUGIN_ROOT} because that is the one copy guaranteed to be the
# version now loaded — a stale wrapper would report on itself. The subcommand
# prints nothing when every surface already reaches this install.
#
# See ai-sdlc/src/claude/skills/ai-cli-tool (Architecture Rule 11).

set -euo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -n "$PLUGIN_ROOT" ] || exit 0
[ -f "$PLUGIN_ROOT/dist/cli.js" ] || exit 0

exec node "$PLUGIN_ROOT/dist/cli.js" freshness
