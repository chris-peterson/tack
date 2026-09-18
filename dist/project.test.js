import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
let projection;
let route;
const home = mkdtempSync(join(tmpdir(), "tack-home-"));
const store = mkdtempSync(join(tmpdir(), "tack-store-"));
process.env.TACK_HOME = home;
before(async () => {
    projection = await import("./project.js");
    route = await import("./route.js");
});
after(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
});
beforeEach(() => {
    rmSync(join(home, "routes"), { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
    mkdirSync(store, { recursive: true });
});
function writeStoreRoute(slug, lines, year = "2026") {
    const dir = join(store, year, "routes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slug}.yaml`), lines.join("\n") + "\n", "utf-8");
}
const head = (slug, uuid) => [
    `slug: ${slug}`,
    `id: ${uuid}`,
    "created_at: '2026-01-01T00:00:00.000Z'",
];
describe("project", () => {
    it("refuses to guess where the store is", () => {
        assert.throws(() => projection.resolveStore(), /no store configured/);
    });
    it("reads every year, so a route outliving its year stays findable", () => {
        writeStoreRoute("older", head("older", "11111111-1111-4111-8111-111111111111"), "2025");
        writeStoreRoute("newer", head("newer", "22222222-2222-4222-8222-222222222222"));
        assert.deepEqual(projection.readStore(store).map((r) => r.slug), ["older", "newer"]);
    });
    it("refuses a filename that disagrees with its slug", () => {
        writeStoreRoute("stated", head("actual", "33333333-3333-4333-8333-333333333333"));
        assert.throws(() => projection.readStore(store), /slug is "actual"/);
    });
    it("derives the deliverable from url shape and labels the rest", () => {
        writeStoreRoute("demo", [
            ...head("demo", "44444444-4444-4444-8444-444444444444"),
            "tacks:",
            "- id: t1",
            "  summary: Ship it",
            "  urls:",
            "  - https://github.com/acme/api/pull/7",
            "  - url: https://docs.acme.com/design",
            "    label: design doc",
        ]);
        projection.project({ store });
        const t = route.load("demo").tacks[0];
        assert.equal(t.deliverable?.url, "https://github.com/acme/api/pull/7");
        assert.equal(t.deliverable?.label, "api#7");
        assert.deepEqual(t.links, [{ label: "design doc", url: "https://docs.acme.com/design" }]);
    });
    it("leaves the deliverable unset when two change requests make it ambiguous", () => {
        writeStoreRoute("demo", [
            ...head("demo", "55555555-5555-4555-8555-555555555555"),
            "tacks:",
            "- id: t1",
            "  summary: Ambiguous",
            "  urls:",
            "  - https://github.com/acme/api/pull/7",
            "  - https://github.com/acme/api/pull/8",
        ]);
        projection.project({ store });
        const t = route.load("demo").tacks[0];
        assert.equal(t.deliverable, undefined);
        assert.equal(t.links?.length, 2);
    });
    it("honors the deliverable the store names when it is ambiguous", () => {
        writeStoreRoute("demo", [
            ...head("demo", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
            "tacks:",
            "- id: t1",
            "  summary: Settled",
            "  deliverable: https://github.com/acme/api/pull/8",
            "  urls:",
            "  - https://github.com/acme/api/pull/7",
            "  - https://github.com/acme/api/pull/8",
        ]);
        projection.project({ store });
        assert.equal(route.load("demo").tacks[0].deliverable?.url, "https://github.com/acme/api/pull/8");
    });
    it("carries a completed status forward, since the forge owns it", () => {
        writeStoreRoute("demo", [
            ...head("demo", "66666666-6666-4666-8666-666666666666"),
            "tacks:",
            "- id: t1",
            "  summary: Ship it",
            "  urls:",
            "  - https://github.com/acme/api/pull/7",
        ]);
        projection.project({ store });
        route.markDone("demo", "t1");
        const doneAt = route.load("demo").tacks[0].done_at;
        const report = projection.project({ store });
        const t = route.load("demo").tacks[0];
        assert.equal(t.status, "done");
        assert.equal(t.done_at, doneAt);
        assert.equal(report.carried, 1);
    });
    it("reports a dry run without writing", () => {
        writeStoreRoute("demo", [
            ...head("demo", "77777777-7777-4777-8777-777777777777"),
            "tacks:",
            "- id: t1",
            "  summary: Ship it",
        ]);
        const report = projection.project({ store, dryRun: true });
        assert.deepEqual(report.created, ["demo"]);
        assert.equal(route.routeExists("demo"), false);
    });
    it("writes nothing on a second run with nothing changed", () => {
        writeStoreRoute("demo", [
            ...head("demo", "88888888-8888-4888-8888-888888888888"),
            "tacks:",
            "- id: t1",
            "  summary: Ship it",
        ]);
        projection.project({ store });
        const report = projection.project({ store });
        assert.equal(report.unchanged, 1);
        assert.deepEqual(report.updated, []);
    });
    it("keeps dependency edges, which no forge implies", () => {
        writeStoreRoute("demo", [
            ...head("demo", "99999999-9999-4999-8999-999999999999"),
            "tacks:",
            "- id: t1",
            "  summary: First",
            "- id: t2",
            "  summary: Second",
            "  depends_on:",
            "  - t1",
        ]);
        projection.project({ store });
        assert.deepEqual(route.load("demo").tacks[1].depends_on, ["t1"]);
    });
});
