#!/usr/bin/env python3
"""Parse a /start issue/MR URL and slugify a label — the deterministic half of
session setup, extracted from prose so the agent doesn't re-derive URL parsing
and slug rules on every invocation (per the "Script for Repeatability" pattern).

Usage:
    parse-start-args.py [URL] [--hint TEXT]

Prints key=value lines on stdout. Keys that don't apply are omitted:
    repo=<repository name>
    ref_type=<issue|mr|pull>
    number=<numeric id>
    prefix=<# or !>     # the reference notation for {prefix}{N}
    ref=<prefix><number>
    slug=<slugified --hint, if given>

The side-effectful steps (beacon, git branch, tack) stay in the skill — they
need agent judgment and are simple command sequences, not parsing logic.
"""
import re
import sys


def slugify(text: str, max_len: int = 60) -> str:
    """lowercase; non-alphanumerics -> hyphens; collapse; strip; truncate."""
    s = re.sub(r"[^a-z0-9]+", "-", text.lower())
    s = re.sub(r"-{2,}", "-", s).strip("-")
    if len(s) > max_len:
        s = s[:max_len].rstrip("-")
    return s


# (regex, ref_type, prefix). GitLab issues use #, MRs use !; GitHub uses # for both.
URL_PATTERNS = [
    (re.compile(r"https?://[^/]+/(?:.+/)?(?P<repo>[^/]+)/-/issues/(?P<number>\d+)"), "issue", "#"),
    (re.compile(r"https?://[^/]+/(?:.+/)?(?P<repo>[^/]+)/-/merge_requests/(?P<number>\d+)"), "mr", "!"),
    (re.compile(r"https?://github\.com/[^/]+/(?P<repo>[^/]+)/issues/(?P<number>\d+)"), "issue", "#"),
    (re.compile(r"https?://github\.com/[^/]+/(?P<repo>[^/]+)/pull/(?P<number>\d+)"), "pull", "#"),
]


def parse_url(url: str):
    for pattern, ref_type, prefix in URL_PATTERNS:
        m = pattern.match(url)
        if m:
            return {
                "repo": m.group("repo"),
                "ref_type": ref_type,
                "number": m.group("number"),
                "prefix": prefix,
                "ref": f"{prefix}{m.group('number')}",
            }
    return None


def main(argv):
    url = None
    hint = None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--hint":
            hint = argv[i + 1] if i + 1 < len(argv) else ""
            i += 2
            continue
        if arg.startswith("http://") or arg.startswith("https://"):
            url = arg
        i += 1

    out = {}
    if url:
        parsed = parse_url(url)
        if parsed is None:
            print(f"error=unrecognized URL: {url}", file=sys.stderr)
            return 1
        out.update(parsed)
    if hint:
        out["slug"] = slugify(hint)

    for key in ("repo", "ref_type", "number", "prefix", "ref", "slug"):
        if key in out:
            print(f"{key}={out[key]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
