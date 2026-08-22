import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { maxLengths, validate } from "./schema.js";

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
      const data = parse(readFileSync(join(examplesDir, file), "utf-8")) as { slug?: string };
      assert.equal(`${data.slug}.yaml`, file);
    });
  }
});

// [STORE-10] restates the schema's length limits so someone reading the spec
// learns them without opening the JSON. Two copies of a number drift the moment
// either side moves; this is what stops it.
describe("the spec's length table matches the schema", () => {
  const spec = readFileSync(join(root, "SPEC.md"), "utf-8");
  const section = spec.slice(spec.indexOf("**[STORE-10]**"), spec.indexOf("**[STORE-11]**"));

  const stated = new Map<string, number>();
  for (const [, field, limit] of section.matchAll(/^\| `(\w+)`[^|]*\| (\d+) \|/gm)) {
    stated.set(field, Number(limit));
  }

  // The schema keys a limit by its owner (`link.label`, `deliverable.label`);
  // the table names the field once, which only holds while the owners agree.
  const enforced = new Map<string, number>();
  for (const [key, limit] of Object.entries(maxLengths())) {
    const field = key.split(".")[1];
    const seen = enforced.get(field);
    it(`${field} carries one limit across every object that has it`, () => {
      assert.ok(seen === undefined || seen === limit, `${key} is ${limit}, elsewhere ${seen}`);
    });
    enforced.set(field, limit);
  }

  it("states a limit for every field the schema bounds", () => {
    assert.deepEqual([...stated.keys()].sort(), [...enforced.keys()].sort());
  });

  for (const [field, limit] of enforced) {
    it(`states ${field}'s limit as ${limit}`, () => {
      assert.equal(stated.get(field), limit);
    });
  }
});
