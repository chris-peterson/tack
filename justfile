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

# Preview docs site locally
docs:
    python3 scripts/gen-suite-json.py
    docsify serve docs --open

# regenerate .claude-plugin/plugin.json from plugin.yml (the canonical descriptor)
plugin-json:
    python3 scripts/gen-plugin-json.py

# verify plugin.json is in sync with plugin.yml (used by CI and the pre-commit hook)
plugin-json-check:
    python3 scripts/gen-plugin-json.py --check

# verify every CLI command is offered by shell completion (used by CI)
completions-check:
    node scripts/check-completions.mjs

# install the git pre-commit hook that keeps plugin.json in sync with plugin.yml
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
