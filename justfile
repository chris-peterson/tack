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

# Validate the JSON Schema
validate-schema:
    cd schema && npx ajv validate -s route.schema.json -d ../examples/q2-auth-rewrite.yaml

# Show the current spec
spec:
    @cat spec/{{spec}}/SPEC.md

# regenerate all generated artifacts from source (describe, plugin.json, docs)
generate:
    scripts/shipyard generate

# validate source projects cleanly and preview the pending projection (no write)
check:
    scripts/shipyard generate --dry-run

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
