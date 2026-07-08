#!/usr/bin/env bash
# Shared helpers for the URL-detection hooks (hooks/session-nudge.sh,
# hooks/capture-urls.sh), which source this by relative path.
# Source this; don't execute it.

# The pattern both hooks use to spot a GitHub PR/issue or GitLab MR/issue URL.
URL_PATTERN='https://(github\.com/[^/]+/[^/]+/(pull|issues)|gitlab\.[^[:space:]]*/-/(merge_requests|issues))/[0-9]+'

# url_nudges <text> <source-label>
#
# Print a nudge for each PR/MR/issue URL in <text> that no tack tracks yet, so
# the agent ensures a route/tack mapping exists (which — since `tack init`/`add`
# record the session — also attributes this session to the route). A URL that a
# tack already references is skipped, so the hooks stop nagging about work
# that's already recorded.
#
# When `tack` isn't on PATH the tracked-check can't run, so we nudge
# unconditionally — a stray reminder beats a silently-dropped mapping.
url_nudges() {
  local text="$1" source_label="$2" url urls matches out=""
  urls=$(printf '%s' "$text" | grep -oE "$URL_PATTERN" | head -3 || true)
  [ -z "$urls" ] && return 0
  for url in $urls; do
    if command -v tack >/dev/null 2>&1; then
      # `tack find <url> --json` prints a JSON array of the tacks referencing
      # the URL; "[]" (or empty) means no mapping exists yet.
      matches=$(tack find "$url" --json 2>/dev/null || true)
      if [ -n "$matches" ] && [ "$(printf '%s' "$matches" | tr -d '[:space:]')" != "[]" ]; then
        continue
      fi
    fi
    out="${out}${source_label} ${url} — not tracked by any tack yet. Use the tack skill to record it on the active route (deliverable for PR/MR, link otherwise), creating the route/tack if none exists. The skill owns route resolution.\n"
  done
  printf '%s' "$out"
}
