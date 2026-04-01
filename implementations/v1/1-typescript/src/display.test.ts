import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTack, formatRoute, formatList } from "./display.js";
import type { Route, Tack } from "./types.js";

describe("formatTack", () => {
  it("formats a pending tack", () => {
    const tack: Tack = { id: "t1", summary: "Do the thing", status: "pending" };
    const out = formatTack(tack);
    assert.equal(out, "[ ] t1: Do the thing");
  });

  it("formats an in-progress tack", () => {
    const tack: Tack = { id: "t2", summary: "Working", status: "in_progress" };
    assert.ok(formatTack(tack).startsWith("[>]"));
  });

  it("formats a done tack with date", () => {
    const tack: Tack = { id: "t1", summary: "Done", status: "done", done_at: "2026-03-30" };
    const out = formatTack(tack);
    assert.ok(out.includes("[x]"));
    assert.ok(out.includes("[2026-03-30]"));
  });

  it("includes project", () => {
    const tack: Tack = { id: "t1", summary: "Task", status: "pending", project: "my-repo" };
    assert.ok(formatTack(tack).includes("(my-repo)"));
  });

  it("includes dependencies", () => {
    const tack: Tack = { id: "t2", summary: "Task", status: "pending", depends_on: ["t1"] };
    assert.ok(formatTack(tack).includes("depends on: t1"));
  });

  it("includes deliverable", () => {
    const tack: Tack = {
      id: "t1",
      summary: "Task",
      status: "pending",
      deliverable: { label: "PR #42", url: "https://github.com/pr/42" },
    };
    assert.ok(formatTack(tack).includes("deliverable: PR #42"));
  });

  it("includes before items", () => {
    const tack: Tack = {
      id: "t1",
      summary: "Task",
      status: "pending",
      before: [{ id: "b1", text: "Read docs", done: false }],
    };
    assert.ok(formatTack(tack).includes("before: [ ] b1: Read docs"));
  });

  it("includes after items", () => {
    const tack: Tack = {
      id: "t1",
      summary: "Task",
      status: "pending",
      after: [{ id: "a1", text: "Deploy", done: false }],
    };
    assert.ok(formatTack(tack).includes("after: [ ] a1: Deploy"));
  });

  it("includes links", () => {
    const tack: Tack = {
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
    const route: Route = {
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
    const route: Route = {
      id: "uuid",
      slug: "feat",
      created_at: "2026-03-30T00:00:00Z",
      updated_at: "2026-03-30T00:00:00Z",
      tacks: [{ id: "t1", summary: "Build it", status: "in_progress" }],
    };
    const out = formatRoute(route);
    assert.ok(out.includes("[>] t1: Build it"));
  });

  it("shows origin when set", () => {
    const route: Route = {
      id: "uuid",
      slug: "drive-by-fix",
      created_at: "2026-03-30T00:00:00Z",
      updated_at: "2026-03-30T00:00:00Z",
      origin: "tangent",
      tacks: [],
    };
    const out = formatRoute(route);
    assert.ok(out.includes("origin: tangent"));
  });

  it("omits origin when not set", () => {
    const route: Route = {
      id: "uuid",
      slug: "planned-work",
      created_at: "2026-03-30T00:00:00Z",
      updated_at: "2026-03-30T00:00:00Z",
      tacks: [],
    };
    const out = formatRoute(route);
    assert.ok(!out.includes("origin:"));
  });
});

describe("formatList", () => {
  it("returns message when empty", () => {
    assert.equal(formatList([]), "No routes found.");
  });

  it("formats route summaries", () => {
    const out = formatList([
      { slug: "feat-a", origin: "planned", total: 3, open: 1 },
      { slug: "feat-b", origin: "planned", total: 5, open: 0 },
    ]);
    assert.ok(out.includes("feat-a  (1 open / 3 total)"));
    assert.ok(out.includes("feat-b  (0 open / 5 total)"));
  });

  it("tags tangent routes in list", () => {
    const out = formatList([
      { slug: "planned-work", origin: "planned", total: 3, open: 1 },
      { slug: "drive-by-fix", origin: "tangent", total: 1, open: 0 },
    ]);
    assert.ok(!out.includes("planned-work [tangent]"));
    assert.ok(out.includes("drive-by-fix [tangent]"));
  });
});
