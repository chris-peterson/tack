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
build:
    scripts/shipyard build

# verify committed generated artifacts (plugin.json, describe) match source
check:
    scripts/shipyard check

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

# install the git pre-commit hook that keeps generated artifacts in sync
install-hooks:
    cp scripts/hooks/pre-commit .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    @echo "installed .git/hooks/pre-commit"

# Launch an interactive session with the local plugin loaded
try:
    claude --plugin-dir .

# Launch an interactive session with the plugin loaded and open the tack skill
tack:
    claude --plugin-dir . "/tack:tack"

install:
    claude plugin install tack
