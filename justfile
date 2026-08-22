shipyard :="uvx --from 'git+https://github.com/chris-peterson/shipyard@v2' shipyard"

# Show available recipes
default:
    @just --list

# Run the CLI
run *args:
    npm start -- {{args}}

# Run tests
test: build
    npm test

# Validate every published example against the JSON Schema
validate-schema: build
    node --test dist/schema.test.js

# Show the spec
spec:
    @cat SPEC.md

# build.yml: ts — build, run tests, verify completions
ts: test completions-check

# Compile src/ to dist/, which the tests run against
build:
    npm run build

# Preview the projection CI would commit, writing it into your tree
peek-projection: build
    {{shipyard}} generate
    git --no-pager diff --stat

# lint the shell half of the plugin (hooks, the URL library)
lint-shell:
    shellcheck hooks/*.sh scripts/lib-url.sh

# Re-record the CLI grammar snapshot after an intended usage change
usage-snapshot: build
    printf '# tack CLI grammar snapshot — the public command/flag surface, compared against\n# `tack --help` by src/cli.test.ts. A diff here is a grammar change.\n# Re-record with `just usage-snapshot` when the change is intended.\n' > spec/cli-usage.txt
    node dist/cli.js --help >> spec/cli-usage.txt

# Preview the docs site locally — dirties the tracked docs/cli.md
docs:
    {{shipyard}} build-docs
    docsify serve docs --open

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
