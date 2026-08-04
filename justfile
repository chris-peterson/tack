spec := "v1"

# Show available recipes
default:
    @just --list

# Run the CLI
run *args:
    npm start -- {{args}}

# Run tests
test:
    npm test

# Validate every published example against the JSON Schema
validate-schema:
    npm run build
    node --test dist/schema.test.js

# Show the current spec
spec:
    @cat spec/{{spec}}/SPEC.md

# regenerate all generated artifacts from source (describe, plugin.json, docs)
generate:
    scripts/shipyard generate

# validate source projects cleanly and preview the pending projection (no write)
check:
    scripts/shipyard generate --dry-run

# the gate CI runs: regenerate projections and fail if the tree changed
# (`check` only previews — its --dry-run exits zero even with drift pending)
check-generated:
    @git diff --quiet || { echo "check-generated compares the whole tree after regenerating, so it needs a clean one — commit or stash first"; exit 1; }
    scripts/shipyard generate
    git diff --exit-code

# verify the committed dist/ (what bin/tack runs) matches src/
check-dist:
    @git diff --quiet dist || { echo "check-dist needs a committed dist/ — build output is tracked, so commit or stash it before comparing"; exit 1; }
    npm run build
    git diff --exit-code dist

# lint the shell half of the plugin (hooks, the URL library, the shipyard shim)
lint-shell:
    shellcheck hooks/*.sh scripts/lib-url.sh scripts/shipyard

# re-record the CLI grammar snapshot after an intended usage change
# (the leading # lines are the file's own header; cli.test.ts strips them)
usage-snapshot:
    npm run build
    printf '# tack CLI grammar snapshot — the public command/flag surface, compared against\n# `tack --help` by src/cli.test.ts. A diff here is a grammar change.\n# Re-record with `just usage-snapshot` when the change is intended.\n' > spec/{{spec}}/cli-usage.txt
    node dist/cli.js --help >> spec/{{spec}}/cli-usage.txt

# preview the docsify docs site locally
docs:
    scripts/shipyard build-docs
    docsify serve docs --open

# regenerate .claude-plugin/plugin.json from plugin.yml (the canonical descriptor)
plugin-json:
    scripts/shipyard gen-plugin-json

# resync plugin.yml suite.describe from the skills/rules/hooks sources
describe:
    scripts/shipyard gen-describe

# verify every CLI command is offered by shell completion (used by CI)
completions-check:
    node scripts/check-completions.mjs

# Launch an interactive session with the local plugin loaded
try:
    claude --plugin-dir .

# Launch an interactive session with the plugin loaded and open the tack skill
tack:
    claude --plugin-dir . "/tack:tack"

install:
    claude plugin install tack
