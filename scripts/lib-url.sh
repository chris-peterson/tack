#!/usr/bin/env bash
# Shared helpers for the hooks that read URLs out of announcements and tool
# output (hooks/session-nudge.sh, hooks/capture-urls.sh,
# hooks/record-landed.sh), which source this by relative path.
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

# The suite's interop announcements. One self-contained line on the publisher's
# stdout: the key, then a compact JSON object. The contract and anchor's own
# declaration are the reference:
# https://github.com/chris-peterson/claude-marketplace/blob/main/authoring/plugin-contract.md
#
# One pattern per reaction rather than one for every key tack hears, because the
# reactions differ: an artifact to record, a change request that landed, a
# release to attach. Each is anchored at the start of a line, so a key named
# mid-sentence is prose rather than an announcement.
#
# TRACKABLE is the precise half of URL detection, and it earns its place rather
# than duplicating the scrape: URL_PATTERN recognizes `github.com` and
# `gitlab.*` hosts only, so a self-hosted forge is invisible to it. An
# announcement carries its own `uri` and is seen whatever the host. The three
# keys in it carry a URL a route should hold: a change request (`cr.created` or
# `cr.updated`, one or the other per run and never both) and an issue anchor's
# `issue` skill just filed.
ANNOUNCED_TRACKABLE='^codes\.bridgeai\.anchor/(cr\.(created|updated)|issue\.created)[[:space:]]'
ANNOUNCED_MERGED='^codes\.bridgeai\.anchor/cr\.merged[[:space:]]'
ANNOUNCED_RELEASE='^codes\.bridgeai\.anchor/release\.created[[:space:]]'

# An announced value is exactly as untrusted as a scraped one: both arrive in a
# Bash tool's stdout, and both reach a string printed into the agent's context.
# So a URI is held to the shape URL_PATTERN enforces (https, no whitespace, no
# backslash) whatever key carried it. The JSON body makes the announcement
# itself newline-proof but says nothing about what a *decoded* value may hold.
ANNOUNCED_URL_SHAPE='^https://[^[:space:]\\]+$'

# The shapes `tack done --date` accepts, which is where an announced merge time
# is bound for: `YYYY-MM-DD`, or an ISO-8601 date-time carrying seconds and a
# zone. GitHub's `mergedAt` and GitLab's `merged_at` are both the second form.
# Checked here rather than left to the CLI because this value is written into a
# route file, and a caller that has to decide whether to write at all needs the
# answer before it runs anything.
ANNOUNCED_DATE_SHAPE='^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2}))?$'

# announced_urls <text> <key-pattern>
#
# Print the `uri` of each announcement in <text> whose key matches
# <key-pattern>, one per line, dropping any that fails ANNOUNCED_URL_SHAPE.
#
# A body that will not parse is skipped rather than reported: the contract puts
# that on the publisher, and a malformed line from a sibling must not take a
# hook down.
announced_urls() {
  printf '%s' "$1" \
    | grep -E "$2" \
    | sed 's/^[^[:space:]]*[[:space:]]//' \
    | jq -r 'try (.uri // empty) catch empty' 2>/dev/null \
    | grep -E "$ANNOUNCED_URL_SHAPE" \
    || true
}

# announced_pairs <text> <key-pattern> <second-field>
#
# Print one `<uri><tab><second-field>` record per matching announcement.
#
# Read as a pair out of one body rather than by scanning each field over the
# whole text: a run that merged two change requests would otherwise cross one
# CR's URI with the other's merge time. Validation is the caller's, which is
# what lets it fall back to a nudge on a value it won't write.
announced_pairs() {
  printf '%s' "$1" \
    | grep -E "$2" \
    | sed 's/^[^[:space:]]*[[:space:]]//' \
    | jq -r --arg f "$3" \
        'try (select(.uri != null) | [.uri, (.[$f] // "")] | @tsv) catch empty' 2>/dev/null \
    || true
}

# One reader per reaction, so a hook asks for the fact it acts on and the
# mapping from key to reaction stays here. A hook naming a pattern itself would
# be one typo away from matching nothing, which reads exactly like an event that
# never fired.
announced_trackable_urls() {
  announced_urls "$1" "$ANNOUNCED_TRACKABLE"
}

announced_merges() {
  announced_pairs "$1" "$ANNOUNCED_MERGED" merged_at
}

announced_releases() {
  announced_pairs "$1" "$ANNOUNCED_RELEASE" tag
}

# announced_url_ok <value> / announced_date_ok <value>
#
# Whether an announced value is safe to pass on. Separate predicates because a
# caller acting on a merge holds both and reacts differently to each: a URI it
# cannot vouch for is dropped, while a merge time it cannot vouch for still
# leaves a CR worth reporting.
announced_url_ok() {
  printf '%s' "${1:-}" | grep -qE "$ANNOUNCED_URL_SHAPE"
}

announced_date_ok() {
  printf '%s' "${1:-}" | grep -qE "$ANNOUNCED_DATE_SHAPE"
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
