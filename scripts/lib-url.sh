#!/usr/bin/env bash
# Shared helpers for the URL-detection hooks (hooks/session-nudge.sh,
# hooks/capture-urls.sh), which source this by relative path.
# Source this; don't execute it.

# The agent-facing reference the nudges point at, resolved from this file's own
# location so it holds under any plugin root.
TACK_GUIDE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/guides/routes.md"

# The pattern both hooks use to spot a GitHub PR/issue or GitLab MR/issue/
# epic/milestone URL. GitLab serves issues from both /-/issues/<n> and the newer
# /-/work_items/<n>; both are live, so both are matched.
#
# The GitLab arm excludes backslashes as well as whitespace. A matched URL is
# attacker-authored text — it arrives from a Bash tool's stdout or a pasted
# prompt — and it ends up in the string the hooks print into the agent's
# context, so a `\n` riding inside one is a way to forge lines there. The
# emitting printf is what actually closes that (see url_nudges below); rejecting
# the character here means a payload never reaches it in the first place.
URL_PATTERN='https://(github\.com/[^/]+/[^/]+/(pull|issues)|gitlab\.[^[:space:]\\]*/-/(merge_requests|issues|work_items|epics|milestones))/[0-9]+'

# The suite's interop announcement for a CR anchor opened. One self-contained
# line on the publisher's stdout, payload as bare `KEY=value` tokens; the
# contract lives in the marketplace repo at `authoring/plugin-contract.md`.
#
# This is the precise half of URL detection, and it earns its place rather than
# duplicating the scrape: URL_PATTERN recognizes `github.com` and `gitlab.*`
# hosts only, so a self-hosted forge is invisible to it. An announcement carries
# its own `CR_URL` and is seen whatever the host.
ANNOUNCE_CR_OPENED='^codes\.bridgeai\.anchor/cr\.opened([[:space:]]|$)'

# announced_cr_urls <text>
#
# Print the `CR_URL` of each `cr.opened` announcement in <text>, one per line.
#
# An announced value is exactly as untrusted as a scraped one — both arrive in a
# Bash tool's stdout — so it is held to the shape URL_PATTERN enforces: https,
# no whitespace, no backslash. The backslash is the one that matters, for the
# reason given above: these URLs reach a string that is printed into the agent's
# context, and a `\n` riding inside one forges a line there.
announced_cr_urls() {
  printf '%s' "$1" \
    | grep -E "$ANNOUNCE_CR_OPENED" \
    | tr ' ' '\n' \
    | grep -oE '^CR_URL=https://[^[:space:]\\]+' \
    | sed 's/^CR_URL=//' \
    || true
}

# url_nudges <text> <source-label>
#
# Scrape <text> for PR/MR/issue URLs and nudge for each. The scrape half of
# detection: it finds a URL whatever produced it, which is the whole point where
# the source is unknown (a `gh pr view`, a paste, a script nobody wrote down).
url_nudges() {
  url_nudges_for "$(printf '%s' "$1" | grep -oE "$URL_PATTERN" || true)" "$2"
}

# url_nudges_for <newline-separated-urls> <source-label>
#
# Print a nudge for each of <urls> that no tack tracks yet, carrying the
# commands that record it (which — since `tack init`/`add` record the session —
# also attributes this session to the route). A URL that a tack already
# references is skipped, so the hooks stop nagging about work that's already
# recorded.
#
# Takes the URLs rather than the text so a caller with two sources — an
# announcement's own `CR_URL` and the pattern scrape — dedupes and caps across
# both instead of nudging twice for one URL.
#
# When `tack` isn't on PATH the tracked-check can't run, so we nudge
# unconditionally — a stray reminder beats a silently-dropped mapping.
#
# Every line this returns is terminated with a real newline rather than a
# literal `\n`, so callers print it with `printf '%s'`. The URL is untrusted
# text and `printf '%b'` would expand any backslash escape inside it, letting it
# emit free-standing lines into the agent's context — a prompt-injection
# primitive. Read the URLs with `read -r` for the same reason: an unquoted
# `for` split would word-split and glob-expand them.
url_nudges_for() {
  local urls source_label="$2" url matches out=""
  # Dedupe on first occurrence, drop blanks, then cap. The cap belongs here so
  # it counts the URLs actually nudged for, whatever mix they came from.
  urls=$(printf '%s' "$1" | awk 'NF && !seen[$0]++' | head -3)
  [ -z "$urls" ] && return 0
  while IFS= read -r url; do
    [ -n "$url" ] || continue
    if command -v tack >/dev/null 2>&1; then
      # `tack find --url <url> --json` prints a JSON array of the tacks
      # referencing the URL; "[]" (or empty) means no mapping exists yet.
      matches=$(tack find --url "$url" --json 2>/dev/null || true)
      if [ -n "$matches" ] && [ "$(printf '%s' "$matches" | tr -d '[:space:]')" != "[]" ]; then
        continue
      fi
    fi
    out="${out}${source_label} ${url} — not tracked by any tack yet. Record it on the active route: the route is the one named for the branch, else for the checkout's directory; \`tack tree <slug>\` lists its tacks. Then \`tack deliverable <slug> <tack-id> <url>\` for a PR/MR, or \`tack link add <slug> <tack-id> <label> <url>\` for an issue, epic, or milestone. With no route yet, \`tack init <slug>\` and \`tack add <slug> <summary>\` open one. Ambiguity, session binding, and the rest: ${TACK_GUIDE}"$'\n'
  done <<EOF
$urls
EOF
  printf '%s' "$out"
}
