spec := "v1"
impl := "1-typescript"

# Show available recipes
default:
    @just --list

# Run the current implementation
run *args:
    cd implementations/{{spec}}/{{impl}} && npm start -- {{args}}

# Run tests for the current implementation
test:
    cd implementations/{{spec}}/{{impl}} && npm test

# Validate the JSON Schema
validate-schema:
    cd schema && npx ajv validate -s route.schema.json -d ../examples/q2-auth-rewrite.yaml

# Show the current spec
spec:
    @cat spec/{{spec}}/SPEC.md

# Preview docs site locally
docs:
    docsify serve docs --open

# Launch an interactive session with the local plugin loaded
try:
    claude --plugin-dir .

# Launch an interactive session with the plugin loaded and open the tack skill
tack:
    claude --plugin-dir . "/tack:tack"

# Install the CLI and Claude Code plugin
install:
    cd implementations/{{spec}}/{{impl}} && npm install -g .
    claude plugin install tack
