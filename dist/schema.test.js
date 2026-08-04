import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validate } from "./schema.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(root, "examples");
const examples = readdirSync(examplesDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
describe("published examples conform to the route schema", () => {
    it("finds example fixtures to check", () => {
        assert.ok(examples.length > 0, "examples/ has no .yaml fixtures");
    });
    for (const file of examples) {
        it(`${file} validates`, () => {
            const data = parse(readFileSync(join(examplesDir, file), "utf-8"));
            const result = validate(data);
            assert.ok(result.valid, `${file}:\n${result.errors.join("\n")}`);
        });
        // routePath() keys a route by its filename, so a mismatch would mislead.
        it(`${file} filename matches its slug`, () => {
            const data = parse(readFileSync(join(examplesDir, file), "utf-8"));
            assert.equal(`${data.slug}.yaml`, file);
        });
    }
});
