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
            const data = parse(readFileSync(join(examplesDir, file), "utf-8"));
            assert.equal(`${data.slug}.yaml`, file);
        });
    }
});
const sessionsDir = join(examplesDir, "sessions");
const sessionExamples = readdirSync(sessionsDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
describe("published examples conform to the session schema", () => {
    it("finds session fixtures to check", () => {
        assert.ok(sessionExamples.length > 0, "examples/sessions/ has no .yaml fixtures");
    });
    for (const file of sessionExamples) {
        it(`${file} validates`, () => {
            const data = parse(readFileSync(join(sessionsDir, file), "utf-8"));
            const result = validate(data, "session");
            assert.ok(result.valid, `${file}:\n${result.errors.join("\n")}`);
        });
        // The id is the filename stem, as a route's slug is.
        it(`${file} filename matches its id`, () => {
            const data = parse(readFileSync(join(sessionsDir, file), "utf-8"));
            assert.equal(`${data.id}.yaml`, file);
        });
    }
    it("refuses a tack ref that names no route", () => {
        const result = validate({ id: "sess-x", started_at: "2026-04-01T09:00:00Z", tacks: ["t1"] }, "session");
        assert.equal(result.valid, false);
    });
});
// [STORE-10] restates the schema's length limits so someone reading the spec
// learns them without opening the JSON. Two copies of a number drift the moment
// either side moves; this is what stops it.
describe("the spec's length table matches the schema", () => {
    const spec = readFileSync(join(root, "SPEC.md"), "utf-8");
    const section = spec.slice(spec.indexOf("**[STORE-10]**"), spec.indexOf("**[STORE-11]**"));
    const stated = new Map();
    for (const [, field, limit] of section.matchAll(/^\| `(\w+)`[^|]*\| (\d+) \|/gm)) {
        stated.set(field, Number(limit));
    }
    // The schema keys a limit by its owner (`link.label`, `deliverable.label`);
    // the table names the field once, which only holds while the owners agree.
    const enforced = new Map();
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
// [COMPAT-07] retires a field by removing it from the schema, which leaves ajv
// reporting only that something unknown is present. A route file predating the
// retirement is the case the report has to be useful for.
describe("a retired field is named, not reported as an unknown property", () => {
    const route = (extra, tack = {}) => ({
        id: "550e8400-e29b-41d4-a716-446655440099",
        slug: "legacy",
        created_at: "2026-03-15T10:00:00Z",
        updated_at: "2026-04-01T09:30:00Z",
        ...extra,
        tacks: [{ id: "t1", summary: "a tack", status: "done", ...tack }],
    });
    it("names a tack-level after[] and the release that retired it", () => {
        const result = validate(route({}, { after: [{ id: "a1", text: "x", done: false }] }));
        assert.equal(result.valid, false);
        assert.match(result.errors[0], /`after` was retired in 1\.7/);
    });
    it("names a tack-level before[] the same way", () => {
        const result = validate(route({}, { before: [{ id: "b1", text: "x", done: false }] }));
        assert.equal(result.valid, false);
        assert.match(result.errors[0], /`before` was retired in 1\.7/);
    });
    it("names route-level depends_on, at the route's own path", () => {
        const result = validate(route({ depends_on: ["other-route"] }));
        assert.equal(result.valid, false);
        assert.match(result.errors[0], /^\/: `depends_on` was retired in 1\.7/);
    });
    // The tack-level field is live, so it stays a known property and never
    // reaches the retired-field branch that shares its name.
    it("leaves tack-level depends_on valid", () => {
        const result = validate(route({}, { depends_on: [] }));
        assert.ok(result.valid, result.errors.join("\n"));
    });
    it("still reports a genuinely unknown property as one", () => {
        const result = validate(route({ nonsense: 1 }));
        assert.equal(result.valid, false);
        assert.match(result.errors[0], /must NOT have additional properties/);
    });
    // A route predating the session store carries the records it now owns. The
    // generic retirement message would say to remove the field, throwing them
    // away.
    it("names the session store when a route still carries session records", () => {
        const result = validate(route({ sessions: [{ id: "sess-1", started_at: "2026-03-15T10:00:00Z" }] }));
        assert.equal(result.valid, false);
        assert.match(result.errors[0], /sessions live in their own store now/);
        assert.match(result.errors[0], /sessions\//);
    });
});
