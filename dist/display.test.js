import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTack, formatRoute, formatList, treeData } from "./display.js";
describe("formatTack", () => {
    it("formats a pending tack", () => {
        const tack = { id: "t1", summary: "Do the thing", status: "pending" };
        const out = formatTack(tack);
        assert.equal(out, "[ ] t1: Do the thing");
    });
    it("formats an in-progress tack", () => {
        const tack = { id: "t2", summary: "Working", status: "in_progress" };
        assert.ok(formatTack(tack).startsWith("[>]"));
    });
    it("formats a done tack with date", () => {
        const tack = { id: "t1", summary: "Done", status: "done", done_at: "2026-03-30" };
        const out = formatTack(tack);
        assert.ok(out.includes("[x]"));
        assert.ok(out.includes("[2026-03-30]"));
    });
    it("includes dependencies", () => {
        const tack = { id: "t2", summary: "Task", status: "pending", depends_on: ["t1"] };
        assert.ok(formatTack(tack).includes("depends on: t1"));
    });
    it("includes deliverable", () => {
        const tack = {
            id: "t1",
            summary: "Task",
            status: "pending",
            deliverable: { label: "PR #42", url: "https://github.com/pr/42" },
        };
        assert.ok(formatTack(tack).includes("deliverable: PR #42"));
    });
    it("includes before items", () => {
        const tack = {
            id: "t1",
            summary: "Task",
            status: "pending",
            before: [{ id: "b1", text: "Read docs", done: false }],
        };
        assert.ok(formatTack(tack).includes("before: [ ] b1: Read docs"));
    });
    it("includes after items", () => {
        const tack = {
            id: "t1",
            summary: "Task",
            status: "pending",
            after: [{ id: "a1", text: "Deploy", done: false }],
        };
        assert.ok(formatTack(tack).includes("after: [ ] a1: Deploy"));
    });
    it("includes links", () => {
        const tack = {
            id: "t1",
            summary: "Task",
            status: "pending",
            links: [{ label: "Design doc", url: "https://example.com/design" }],
        };
        assert.ok(formatTack(tack).includes("link: Design doc"));
    });
});
describe("formatRoute", () => {
    it("formats an empty route", () => {
        const route = {
            id: "uuid",
            slug: "my-route",
            created_at: "2026-03-30T00:00:00Z",
            updated_at: "2026-03-30T00:00:00Z",
            tacks: [],
        };
        const out = formatRoute(route);
        assert.ok(out.includes("# my-route"));
        assert.ok(out.includes("(no tacks)"));
    });
    it("formats a route with tacks", () => {
        const route = {
            id: "uuid",
            slug: "feat",
            created_at: "2026-03-30T00:00:00Z",
            updated_at: "2026-03-30T00:00:00Z",
            tacks: [{ id: "t1", summary: "Build it", status: "in_progress" }],
        };
        const out = formatRoute(route);
        assert.ok(out.includes("[>] t1: Build it"));
    });
});
describe("treeData", () => {
    const routes = [
        {
            id: "u1",
            slug: "auth",
            created_at: "2026-03-30T00:00:00Z",
            updated_at: "2026-03-30T00:00:00Z",
            tacks: [
                {
                    id: "t1",
                    summary: "Build it",
                    status: "done",
                    deliverable: { label: "PR #1", url: "https://github.com/pr/1" },
                    depends_on: ["t0"],
                },
                { id: "t2", summary: "Test it", status: "pending" },
            ],
        },
        {
            id: "u2",
            slug: "billing",
            created_at: "2026-03-30T00:00:00Z",
            updated_at: "2026-03-30T00:00:00Z",
            tacks: [{ id: "t1", summary: "Invoices", status: "pending" }],
        },
    ];
    it("returns all routes with no path", () => {
        assert.deepEqual(treeData(routes), routes);
    });
    it("returns a single route for a slug", () => {
        assert.equal(treeData(routes, "auth"), routes[0]);
    });
    it("returns a single tack for slug/tack", () => {
        assert.equal(treeData(routes, "auth/t1"), routes[0].tacks[0]);
    });
    it("returns the aspect value for slug/tack/aspect", () => {
        assert.deepEqual(treeData(routes, "auth/t1/deliverable"), {
            deliverable: { label: "PR #1", url: "https://github.com/pr/1" },
        });
    });
    it("reports an unknown aspect as an error object", () => {
        assert.deepEqual(treeData(routes, "auth/t1/bogus"), { error: "Unknown aspect: bogus" });
    });
    it("returns matched routes for a slug-pattern glob", () => {
        assert.deepEqual(treeData(routes, "b*"), [routes[1]]);
    });
    it("returns {slug, tack} matches for a two-part glob", () => {
        assert.deepEqual(treeData(routes, "*/t2"), [{ slug: "auth", tack: routes[0].tacks[1] }]);
    });
    it("returns aspect matches for a three-part glob, skipping absent aspects", () => {
        assert.deepEqual(treeData(routes, "*/*/deliverable"), [
            {
                slug: "auth",
                tackId: "t1",
                aspect: "deliverable",
                value: { label: "PR #1", url: "https://github.com/pr/1" },
            },
        ]);
    });
});
describe("formatList", () => {
    it("returns message when empty", () => {
        assert.equal(formatList([]), "No routes found.");
    });
    it("formats route summaries", () => {
        const out = formatList([
            { slug: "feat-a", total: 3, open: 1 },
            { slug: "feat-b", total: 5, open: 0 },
        ]);
        assert.ok(out.includes("feat-a  (1 open / 3 total)"));
        assert.ok(out.includes("feat-b  (0 open / 5 total)"));
    });
});
