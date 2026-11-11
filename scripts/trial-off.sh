#!/usr/bin/env bash
# End a trial (`just trial-on`): put the highest installed plugin build back on
# PATH. Reinstalls through the plugin's own `install-cli` — the same path
# `/tack:install-tack` takes — so ending a trial lands exactly what a user has,
# rather than a wrapper this script hand-wrote.
set -euo pipefail

cache="${HOME}/.claude/plugins/cache/chris-peterson/tack"

if [ ! -d "$cache" ]; then
	echo "No installed tack plugin found under $cache." >&2
	echo "Install it with \`claude plugin install tack\`, then re-run." >&2
	exit 1
fi

# Versions sort as numbers, so 1.10.0 beats 1.9.0.
root=$(find "$cache" -mindepth 1 -maxdepth 1 -type d \
	| awk -F/ '{ split($NF, v, "."); printf "%010d%010d%010d\t%s\n", v[1], v[2], v[3], $0 }' \
	| sort \
	| tail -1 \
	| cut -f2)

if [ -z "$root" ]; then
	echo "No plugin versions under $cache." >&2
	exit 1
fi

shim="$root/bin/tack"
if [ ! -x "$shim" ]; then
	echo "Plugin at $root has no runnable bin/tack." >&2
	exit 1
fi

CLAUDE_PLUGIN_ROOT="$root" "$shim" install-cli

echo
echo "Restored $("$shim" --version) from the plugin cache."
