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
    cd schema && npx ajv validate -s route.schema.json -d ../examples/lightbox-migration.yaml

# Show the current spec
spec:
    @cat spec/{{spec}}/SPEC.md
