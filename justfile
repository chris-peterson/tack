shipyard := "uvx --from 'git+https://github.com/chris-peterson/shipyard@v2' shipyard"

# What this is, and every recipe there is
[private]
default:
    @echo ""
    @echo "  tack — a route schema and CLI that pins AI-assisted work to disk:"
    @echo "  where you were, what you're delivering, what depends on what."
    @echo ""
    @echo "  New here?   just setup    install the npm dependencies"
    @echo "  Broken?     just check    name any missing prerequisite"
    @echo ""
    @just --list --unsorted --list-prefix '    '
    @echo ""
    @echo "  Recipes that compile install the dependencies for you on a fresh"
    @echo "  checkout; the rest name the tool they want. \`just check\` lists them."
    @echo ""

# Install the npm dependencies, exactly as the lockfile pins them
[group('start here')]
setup:
    npm ci

# Report every prerequisite and which recipes want it
[group('start here')]
check:
    #!/usr/bin/env bash
    set -uo pipefail
    missing=0
    report() { printf '  %-8s %-12s %s\n' "$1" "$2" "$3"; }
    require() {
        if command -v "$1" >/dev/null 2>&1; then report ok "$1" "$2"
        else report MISSING "$1" "$2"; missing=1; fi
    }
    optional() {
        if command -v "$1" >/dev/null 2>&1; then report ok "$1" "$2"
        else report absent "$1" "$2"; fi
    }
    echo
    require node       "build, test, run"
    require npm        "build, test, run"
    optional uvx       "check-generated, docs — https://docs.astral.sh/uv/"
    optional docsify   "docs — npm i -g docsify-cli"
    optional shellcheck "lint-shell — brew install shellcheck"
    optional claude    "try, install-plugin"
    if [ -d node_modules ]; then
        report ok node_modules "dependencies installed"
    else
        report absent node_modules "run \`just setup\`, or let \`just build\` do it"
    fi
    echo
    exit "$missing"

# Run the CLI from this working copy
[group('start here')]
run *args: _deps
    npm start -- {{args}}

# Compile src/ to dist/, which the tests and `bin/tack` run against
[group('build and test')]
build: _deps
    npm run build

# Run the test suite
[group('build and test')]
test: build
    npm test

# Validate every published example against the JSON Schema
[group('build and test')]
validate-schema: build
    node --test dist/schema.test.js

# Verify every CLI command is offered by shell completion (used by CI)
[group('build and test')]
completions-check:
    node scripts/check-completions.mjs

# Lint the shell half of the plugin (hooks, the URL library, the trial helper)
[group('build and test')]
lint-shell:
    shellcheck hooks/*.sh scripts/lib-url.sh scripts/trial-off.sh

# Everything build.yml's `ts` job runs — build, test, verify completions
[group('build and test')]
ts: test completions-check

# Re-record the CLI grammar snapshot after an intended usage change
[group('build and test')]
usage-snapshot: build
    printf '# tack CLI grammar snapshot — the public command/flag surface, compared against\n# `tack --help` by src/cli.test.ts. A diff here is a grammar change.\n# Re-record with `just usage-snapshot` when the change is intended.\n' > spec/cli-usage.txt
    node dist/cli.js --help >> spec/cli-usage.txt

# Show what the projection job would commit — leaves it in your tree to inspect
[group('build and test')]
check-generated: build
    {{shipyard}} generate
    git --no-pager diff --stat
    @echo
    @echo "Projected paths are left in your tree; \`git restore .\` discards them."

# Preview the docs site locally — dirties the tracked docs/cli.md
[group('docs')]
docs:
    {{shipyard}} build-docs
    docsify serve docs --open

# Show the spec
[group('docs')]
spec:
    @cat SPEC.md

# Point the `tack` on your PATH at this working copy, until `just trial-off`
[group('use it locally')]
trial-on: build
    @node dist/cli.js install-cli
    @echo
    @echo "Trialling $(node dist/cli.js --version) from $(pwd)."
    @echo "Rebuild with \`just build\` to pick up edits; \`just trial-off\` to revert."

# Put the published plugin build back on your PATH
[group('use it locally')]
trial-off:
    @bash scripts/trial-off.sh

# Launch an interactive Claude Code session with this working copy loaded
[group('use it locally')]
try:
    claude --plugin-dir .

# Install the published plugin from the chris-peterson marketplace
[group('use it locally')]
install-plugin:
    claude plugin install tack@chris-peterson

# `npm ci` on a checkout that hasn't got node_modules yet
[private]
_deps:
    @test -d node_modules || { echo "node_modules is missing — installing (just setup)"; npm ci; }
