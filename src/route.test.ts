import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let route: typeof import("./route.js");

const tmp = mkdtempSync(join(tmpdir(), "tack-test-"));
process.env.TACK_HOME = tmp;

before(async () => {
  route = await import("./route.js");
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  const routesDir = join(tmp, "routes");
  rmSync(routesDir, { recursive: true, force: true });
});

describe("init", () => {
  it("creates a route with the given slug", () => {
    const r = route.init("my-feature");
    assert.equal(r.slug, "my-feature");
    assert.equal(r.tacks.length, 0);
    assert.ok(r.id);
    assert.ok(r.created_at);
  });

  it("throws if route already exists", () => {
    route.init("dup");
    assert.throws(() => route.init("dup"), /already exists/);
  });

});

describe("load", () => {
  it("loads a previously created route", () => {
    route.init("loadable");
    const r = route.load("loadable");
    assert.equal(r.slug, "loadable");
  });

  it("throws for missing route", () => {
    assert.throws(() => route.load("nonexistent"), /not found/i);
  });
});

describe("list", () => {
  it("returns empty array when no routes", () => {
    const result = route.list();
    assert.equal(result.length, 0);
  });

  it("returns route summaries", () => {
    route.init("list-a");
    route.init("list-b");
    const result = route.list();
    assert.equal(result.length, 2);
    const slugs = result.map((r) => r.slug).sort();
    assert.deepEqual(slugs, ["list-a", "list-b"]);
  });
});

describe("addTack", () => {
  it("adds a tack with sequential ids", () => {
    route.init("add-test");
    const t1 = route.addTack("add-test", "First task");
    assert.equal(t1.id, "t1");
    assert.equal(t1.status, "pending");
    assert.equal(t1.summary, "First task");

    const t2 = route.addTack("add-test", "Second task");
    assert.equal(t2.id, "t2");
  });

  it("supports depends-on", () => {
    route.init("dep-test");
    route.addTack("dep-test", "First");
    const t2 = route.addTack("dep-test", "Second", { dependsOn: ["t1"] });
    assert.deepEqual(t2.depends_on, ["t1"]);
  });

  it("rejects invalid dependency", () => {
    route.init("bad-dep");
    assert.throws(
      () => route.addTack("bad-dep", "Task", { dependsOn: ["t99"] }),
      /not found/i
    );
  });
});

describe("startTack", () => {
  it("transitions to in_progress", () => {
    route.init("start-test");
    route.addTack("start-test", "Task");
    const t = route.startTack("start-test", "t1");
    assert.equal(t.status, "in_progress");
  });

  it("rejects start with unmet dependencies", () => {
    route.init("start-dep");
    route.addTack("start-dep", "First");
    route.addTack("start-dep", "Second", { dependsOn: ["t1"] });
    assert.throws(
      () => route.startTack("start-dep", "t2"),
      /unmet dependencies/
    );
  });

  it("allows start when dependencies are done", () => {
    route.init("start-ok");
    route.addTack("start-ok", "First");
    route.addTack("start-ok", "Second", { dependsOn: ["t1"] });
    route.markDone("start-ok", "t1");
    const t = route.startTack("start-ok", "t2");
    assert.equal(t.status, "in_progress");
  });
});

describe("markDone", () => {
  it("marks tack as done with an ISO date-time", () => {
    route.init("done-test");
    route.addTack("done-test", "Task");
    const { tack } = route.markDone("done-test", "t1");
    assert.equal(tack.status, "done");
    assert.match(tack.done_at!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("accepts an explicit ISO date via --at", () => {
    route.init("done-backfill-date");
    route.addTack("done-backfill-date", "Task");
    const { tack } = route.markDone("done-backfill-date", "t1", { at: "2026-04-30" });
    assert.equal(tack.done_at, "2026-04-30");
  });

  it("accepts an explicit ISO date-time via --at", () => {
    route.init("done-backfill-dt");
    route.addTack("done-backfill-dt", "Task");
    const { tack } = route.markDone("done-backfill-dt", "t1", { at: "2026-04-30T17:00:00Z" });
    assert.equal(tack.done_at, "2026-04-30T17:00:00Z");
  });

  it("rejects an invalid timestamp", () => {
    route.init("done-backfill-bad");
    route.addTack("done-backfill-bad", "Task");
    assert.throws(
      () => route.markDone("done-backfill-bad", "t1", { at: "not-a-date" }),
      /Invalid timestamp/,
    );
  });

  it("returns pending after items", () => {
    route.init("done-after");
    route.addTack("done-after", "Task");
    route.addAfter("done-after", "t1", "Deploy to prod");
    const { pendingTodo } = route.markDone("done-after", "t1");
    assert.deepEqual(pendingTodo, ["Deploy to prod"]);
  });
});

describe("addTack backfill", () => {
  it("creates an already-done tack with current ISO timestamp", () => {
    route.init("add-done");
    const t = route.addTack("add-done", "Already merged", { done: true });
    assert.equal(t.status, "done");
    assert.match(t.done_at!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("creates an already-done tack with an explicit date", () => {
    route.init("add-done-date");
    const t = route.addTack("add-done-date", "Merged ages ago", {
      done: true,
      doneAt: "2026-04-09",
    });
    assert.equal(t.status, "done");
    assert.equal(t.done_at, "2026-04-09");
  });

  it("sets a deliverable when one is provided at creation", () => {
    route.init("add-deliverable");
    const t = route.addTack("add-deliverable", "Merged work", {
      done: true,
      doneAt: "2026-04-30",
      deliverable: { label: "repo #42", url: "https://github.com/owner/repo/pull/42" },
    });
    assert.equal(t.deliverable!.url, "https://github.com/owner/repo/pull/42");
    assert.equal(t.deliverable!.label, "repo #42");
  });

  it("rejects an invalid doneAt", () => {
    route.init("add-done-bad");
    assert.throws(
      () => route.addTack("add-done-bad", "Task", { done: true, doneAt: "yesterday" }),
      /Invalid timestamp/,
    );
  });
});

describe("deriveDeliverableLabel", () => {
  it("parses GitHub PR URLs", () => {
    assert.equal(
      route.deriveDeliverableLabel("https://github.com/owner/repo/pull/42"),
      "repo #42",
    );
  });

  it("parses GitHub issue URLs", () => {
    assert.equal(
      route.deriveDeliverableLabel("https://github.com/owner/repo/issues/7"),
      "repo #7",
    );
  });

  it("parses GitLab MR URLs", () => {
    assert.equal(
      route.deriveDeliverableLabel("https://gitlab.example.com/group/sub/repo/-/merge_requests/99"),
      "repo !99",
    );
  });

  it("parses GitLab issue URLs", () => {
    assert.equal(
      route.deriveDeliverableLabel("https://gitlab.example.com/group/repo/-/issues/12"),
      "repo #12",
    );
  });

  it("falls back to the URL for unknown patterns", () => {
    const url = "https://example.com/foo/bar";
    assert.equal(route.deriveDeliverableLabel(url), url);
  });
});

describe("backward-compat date-only done_at", () => {
  it("loads a route whose done_at is a bare YYYY-MM-DD", () => {
    route.init("legacy-date");
    const t = route.addTack("legacy-date", "Task");
    route.markDone("legacy-date", t.id, { at: "2026-04-30" });
    const reloaded = route.load("legacy-date");
    assert.equal(reloaded.tacks[0].done_at, "2026-04-30");
  });
});

describe("markDropped", () => {
  it("marks tack as dropped", () => {
    route.init("drop-test");
    route.addTack("drop-test", "Task");
    const t = route.markDropped("drop-test", "t1");
    assert.equal(t.status, "dropped");
  });
});

describe("setDeliverable", () => {
  it("sets a deliverable on a tack", () => {
    route.init("dlv-test");
    route.addTack("dlv-test", "Task");
    const t = route.setDeliverable("dlv-test", "t1", "PR #42", "https://github.com/pr/42");
    assert.equal(t.deliverable!.label, "PR #42");
    assert.equal(t.deliverable!.url, "https://github.com/pr/42");
  });

  it("refuses to overwrite an existing deliverable without force", () => {
    route.init("dlv-protected");
    route.addTack("dlv-protected", "Task");
    route.setDeliverable("dlv-protected", "t1", "PR #1", "https://github.com/pr/1");
    assert.throws(
      () => route.setDeliverable("dlv-protected", "t1", "PR #2", "https://github.com/pr/2"),
      /already has a deliverable/,
    );
    const t = route.load("dlv-protected").tacks[0];
    assert.equal(t.deliverable!.url, "https://github.com/pr/1");
  });

  it("overwrites existing deliverable with force", () => {
    route.init("dlv-force");
    route.addTack("dlv-force", "Task");
    route.setDeliverable("dlv-force", "t1", "PR #1", "https://github.com/pr/1");
    const t = route.setDeliverable("dlv-force", "t1", "PR #2", "https://github.com/pr/2", { force: true });
    assert.equal(t.deliverable!.label, "PR #2");
  });
});

describe("addBefore", () => {
  it("adds a before todo with sequential ids", () => {
    route.init("before-test");
    route.addTack("before-test", "Task");
    const t1 = route.addBefore("before-test", "t1", "Read the docs");
    assert.equal(t1.before!.length, 1);
    assert.equal(t1.before![0].id, "b1");
    assert.equal(t1.before![0].text, "Read the docs");
    assert.equal(t1.before![0].done, false);

    const t2 = route.addBefore("before-test", "t1", "Set up env");
    assert.equal(t2.before!.length, 2);
    assert.equal(t2.before![1].id, "b2");
  });
});

describe("addAfter", () => {
  it("adds an after todo with sequential ids", () => {
    route.init("after-test");
    route.addTack("after-test", "Task");
    const t1 = route.addAfter("after-test", "t1", "Notify team");
    assert.equal(t1.after!.length, 1);
    assert.equal(t1.after![0].id, "a1");
    assert.equal(t1.after![0].text, "Notify team");
    assert.equal(t1.after![0].done, false);

    const t2 = route.addAfter("after-test", "t1", "Update docs");
    assert.equal(t2.after!.length, 2);
    assert.equal(t2.after![1].id, "a2");
  });
});

describe("completeTodo", () => {
  it("marks a before todo as done with date", () => {
    route.init("todo-done-b");
    route.addTack("todo-done-b", "Task");
    route.addBefore("todo-done-b", "t1", "Prereq");
    const t = route.completeTodo("todo-done-b", "t1", "b1");
    assert.equal(t.before![0].done, true);
    assert.ok(t.before![0].done_at);
  });

  it("marks an after todo as done with date", () => {
    route.init("todo-done-a");
    route.addTack("todo-done-a", "Task");
    route.addAfter("todo-done-a", "t1", "Follow up");
    const t = route.completeTodo("todo-done-a", "t1", "a1");
    assert.equal(t.after![0].done, true);
    assert.ok(t.after![0].done_at);
  });

  it("throws for nonexistent todo", () => {
    route.init("todo-done-bad");
    route.addTack("todo-done-bad", "Task");
    assert.throws(
      () => route.completeTodo("todo-done-bad", "t1", "b1"),
      /not found/i
    );
  });
});

describe("dropTodo", () => {
  it("removes a before todo", () => {
    route.init("todo-drop-b");
    route.addTack("todo-drop-b", "Task");
    route.addBefore("todo-drop-b", "t1", "Will remove");
    route.addBefore("todo-drop-b", "t1", "Will keep");
    const t = route.dropTodo("todo-drop-b", "t1", "b1");
    assert.equal(t.before!.length, 1);
    assert.equal(t.before![0].id, "b2");
  });

  it("removes an after todo", () => {
    route.init("todo-drop-a");
    route.addTack("todo-drop-a", "Task");
    route.addAfter("todo-drop-a", "t1", "Will remove");
    const t = route.dropTodo("todo-drop-a", "t1", "a1");
    assert.equal(t.after!.length, 0);
  });

  it("throws for nonexistent todo", () => {
    route.init("todo-drop-bad");
    route.addTack("todo-drop-bad", "Task");
    assert.throws(
      () => route.dropTodo("todo-drop-bad", "t1", "a99"),
      /not found/i
    );
  });
});

describe("editTack", () => {
  it("updates a tack summary", () => {
    route.init("edit-test");
    route.addTack("edit-test", "Original summary");
    const t = route.editTack("edit-test", "t1", "Updated summary");
    assert.equal(t.summary, "Updated summary");
    assert.equal(t.id, "t1");
  });

  it("preserves other tack fields", () => {
    route.init("edit-preserve");
    route.addTack("edit-preserve", "Task");
    route.startTack("edit-preserve", "t1");
    route.addBefore("edit-preserve", "t1", "Pre-work");
    const t = route.editTack("edit-preserve", "t1", "New summary");
    assert.equal(t.status, "in_progress");
    assert.equal(t.before!.length, 1);
  });

  it("throws for nonexistent tack", () => {
    route.init("edit-bad");
    assert.throws(() => route.editTack("edit-bad", "t99", "Nope"), /not found/i);
  });
});

describe("mergeTacks", () => {
  it("merges source links and todos into target", () => {
    route.init("merge-test");
    route.addTack("merge-test", "Target task");
    route.addTack("merge-test", "Source task");
    route.addBefore("merge-test", "t2", "Source prereq");
    route.addAfter("merge-test", "t2", "Source followup");
    route.addLink("merge-test", "t2", "Doc", "https://example.com/doc");

    const t = route.mergeTacks("merge-test", "t2", "t1");
    assert.equal(t.before!.length, 1);
    assert.equal(t.before![0].id, "b1");
    assert.equal(t.before![0].text, "Source prereq");
    assert.equal(t.after!.length, 1);
    assert.equal(t.after![0].text, "Source followup");
    assert.equal(t.links!.length, 1);
    assert.equal(t.links![0].label, "Doc");

    const r = route.load("merge-test");
    const source = r.tacks.find((t) => t.id === "t2");
    assert.equal(source!.status, "dropped");
  });

  it("moves deliverable from source when target has none", () => {
    route.init("merge-dlv");
    route.addTack("merge-dlv", "Target");
    route.addTack("merge-dlv", "Source");
    route.setDeliverable("merge-dlv", "t2", "PR #5", "https://github.com/acme/repo/pull/5");

    const t = route.mergeTacks("merge-dlv", "t2", "t1");
    assert.equal(t.deliverable!.label, "PR #5");
  });

  it("keeps target deliverable when both have one", () => {
    route.init("merge-dlv-both");
    route.addTack("merge-dlv-both", "Target");
    route.addTack("merge-dlv-both", "Source");
    route.setDeliverable("merge-dlv-both", "t1", "Target PR", "https://github.com/acme/repo/pull/1");
    route.setDeliverable("merge-dlv-both", "t2", "Source PR", "https://github.com/acme/repo/pull/2");

    const t = route.mergeTacks("merge-dlv-both", "t2", "t1");
    assert.equal(t.deliverable!.label, "Target PR");
  });

  it("re-IDs todos to avoid conflicts", () => {
    route.init("merge-reids");
    route.addTack("merge-reids", "Target");
    route.addTack("merge-reids", "Source");
    route.addBefore("merge-reids", "t1", "Target prereq");
    route.addBefore("merge-reids", "t2", "Source prereq");

    const t = route.mergeTacks("merge-reids", "t2", "t1");
    assert.equal(t.before!.length, 2);
    assert.equal(t.before![0].id, "b1");
    assert.equal(t.before![1].id, "b2");
  });

  it("throws when merging a tack into itself", () => {
    route.init("merge-self");
    route.addTack("merge-self", "Task");
    assert.throws(() => route.mergeTacks("merge-self", "t1", "t1"), /itself/);
  });
});

describe("addLink", () => {
  it("adds a link to a tack", () => {
    route.init("link-test");
    route.addTack("link-test", "Task");
    const t = route.addLink("link-test", "t1", "Design doc", "https://example.com/design");
    assert.equal(t.links!.length, 1);
    assert.equal(t.links![0].label, "Design doc");
    assert.equal(t.links![0].url, "https://example.com/design");
  });

  it("promotes a GitHub PR link to deliverable", () => {
    route.init("link-pr-promote");
    route.addTack("link-pr-promote", "Task");
    const t = route.addLink("link-pr-promote", "t1", "My PR", "https://github.com/acme/repo/pull/42");
    assert.ok(t.deliverable);
    assert.equal(t.deliverable!.label, "My PR");
    assert.equal(t.deliverable!.url, "https://github.com/acme/repo/pull/42");
    assert.equal(t.links, undefined);
  });

  it("promotes a GitLab MR link to deliverable", () => {
    route.init("link-mr-promote");
    route.addTack("link-mr-promote", "Task");
    const t = route.addLink("link-mr-promote", "t1", "My MR", "https://gitlab.example.com/group/proj/-/merge_requests/99");
    assert.ok(t.deliverable);
    assert.equal(t.deliverable!.url, "https://gitlab.example.com/group/proj/-/merge_requests/99");
    assert.equal(t.links, undefined);
  });

  it("adds PR link to links if deliverable already set", () => {
    route.init("link-pr-existing");
    route.addTack("link-pr-existing", "Task");
    route.setDeliverable("link-pr-existing", "t1", "First PR", "https://github.com/acme/repo/pull/1");
    const t = route.addLink("link-pr-existing", "t1", "Second PR", "https://github.com/acme/repo/pull/2");
    assert.equal(t.deliverable!.url, "https://github.com/acme/repo/pull/1");
    assert.equal(t.links!.length, 1);
    assert.equal(t.links![0].url, "https://github.com/acme/repo/pull/2");
  });

  it("is idempotent when the url already exists in links", () => {
    route.init("link-dup");
    route.addTack("link-dup", "Task");
    route.addLink("link-dup", "t1", "Doc", "https://example.com/doc");
    const t = route.addLink("link-dup", "t1", "Doc v2", "https://example.com/doc");
    assert.equal(t.links!.length, 1);
    assert.equal(t.links![0].label, "Doc");
  });

  it("is idempotent when the url already matches the deliverable", () => {
    route.init("link-dup-deliverable");
    route.addTack("link-dup-deliverable", "Task");
    route.setDeliverable("link-dup-deliverable", "t1", "PR", "https://github.com/acme/repo/pull/1");
    const t = route.addLink("link-dup-deliverable", "t1", "Same PR", "https://github.com/acme/repo/pull/1");
    assert.equal(t.deliverable!.label, "PR");
    assert.equal(t.links, undefined);
  });
});

describe("removeLink", () => {
  it("removes a link by url", () => {
    route.init("link-rm");
    route.addTack("link-rm", "Task");
    route.addLink("link-rm", "t1", "A", "https://example.com/a");
    route.addLink("link-rm", "t1", "B", "https://example.com/b");
    const t = route.removeLink("link-rm", "t1", "https://example.com/a");
    assert.equal(t.links!.length, 1);
    assert.equal(t.links![0].url, "https://example.com/b");
  });

  it("deletes the links field when the last link is removed", () => {
    route.init("link-rm-last");
    route.addTack("link-rm-last", "Task");
    route.addLink("link-rm-last", "t1", "Only", "https://example.com/only");
    const t = route.removeLink("link-rm-last", "t1", "https://example.com/only");
    assert.equal(t.links, undefined);
  });

  it("throws when url does not match any link", () => {
    route.init("link-rm-missing");
    route.addTack("link-rm-missing", "Task");
    route.addLink("link-rm-missing", "t1", "A", "https://example.com/a");
    assert.throws(
      () => route.removeLink("link-rm-missing", "t1", "https://example.com/missing"),
      /No link with url/,
    );
  });
});

describe("markDone promotes PR link to deliverable", () => {
  it("promotes a PR link when no deliverable is set", () => {
    route.init("done-promote");
    route.addTack("done-promote", "Task");
    route.addLink("done-promote", "t1", "Docs", "https://example.com/docs");
    route.addLink("done-promote", "t1", "The PR", "https://github.com/acme/repo/pull/7");
    const { tack } = route.markDone("done-promote", "t1");
    assert.ok(tack.deliverable);
    assert.equal(tack.deliverable!.url, "https://github.com/acme/repo/pull/7");
    assert.equal(tack.links!.length, 1);
    assert.equal(tack.links![0].label, "Docs");
  });

  it("does not overwrite existing deliverable on done", () => {
    route.init("done-no-overwrite");
    route.addTack("done-no-overwrite", "Task");
    route.setDeliverable("done-no-overwrite", "t1", "Original", "https://github.com/acme/repo/pull/1");
    route.addLink("done-no-overwrite", "t1", "Other PR", "https://github.com/acme/repo/pull/2");
    const { tack } = route.markDone("done-no-overwrite", "t1");
    assert.equal(tack.deliverable!.url, "https://github.com/acme/repo/pull/1");
  });
});

describe("recordSession", () => {
  it("adds a session to a route", () => {
    route.init("session-test");
    const r = route.recordSession("session-test", "session_abc123");
    assert.equal(r.sessions!.length, 1);
    assert.equal(r.sessions![0].id, "session_abc123");
    assert.ok(r.sessions![0].started_at);
  });

  it("does not duplicate an existing session and preserves original timestamp", () => {
    route.init("session-dedup");
    const r1 = route.recordSession("session-dedup", "session_abc123");
    const originalStartedAt = r1.sessions![0].started_at;
    const r2 = route.recordSession("session-dedup", "session_abc123");
    assert.equal(r2.sessions!.length, 1);
    assert.equal(r2.sessions![0].started_at, originalStartedAt);
  });

  it("appends multiple distinct sessions", () => {
    route.init("session-multi");
    route.recordSession("session-multi", "session_aaa");
    const r = route.recordSession("session-multi", "session_bbb");
    assert.equal(r.sessions!.length, 2);
  });
});

describe("remove", () => {
  it("deletes a route", () => {
    route.init("rm-test");
    route.remove("rm-test");
    assert.throws(() => route.load("rm-test"), /not found/i);
  });

  it("throws for missing route", () => {
    assert.throws(() => route.remove("ghost"), /not found/i);
  });
});

describe("removeTack", () => {
  it("deletes a tack from a route", () => {
    route.init("rm-tack");
    route.addTack("rm-tack", "First");
    route.addTack("rm-tack", "Second");
    const r = route.removeTack("rm-tack", "t1");
    assert.equal(r.tacks.length, 1);
    assert.equal(r.tacks[0].id, "t2");
  });

  it("does not renumber remaining tacks", () => {
    route.init("rm-tack-ids");
    route.addTack("rm-tack-ids", "First");
    route.addTack("rm-tack-ids", "Second");
    route.addTack("rm-tack-ids", "Third");
    route.removeTack("rm-tack-ids", "t2");
    const next = route.addTack("rm-tack-ids", "Fourth");
    assert.equal(next.id, "t4");
  });

  it("throws for missing tack", () => {
    route.init("rm-tack-missing");
    assert.throws(() => route.removeTack("rm-tack-missing", "t99"), /not found/i);
  });

  it("refuses when other tacks depend on it (without --force)", () => {
    route.init("rm-tack-dep");
    route.addTack("rm-tack-dep", "First");
    route.addTack("rm-tack-dep", "Second", { dependsOn: ["t1"] });
    assert.throws(
      () => route.removeTack("rm-tack-dep", "t1"),
      /depended on by t2/,
    );
    assert.equal(route.load("rm-tack-dep").tacks.length, 2);
  });

  it("strips dangling references with --force", () => {
    route.init("rm-tack-force");
    route.addTack("rm-tack-force", "First");
    route.addTack("rm-tack-force", "Second", { dependsOn: ["t1"] });
    route.addTack("rm-tack-force", "Third", { dependsOn: ["t1"] });
    const r = route.removeTack("rm-tack-force", "t1", { force: true });
    assert.equal(r.tacks.length, 2);
    for (const t of r.tacks) {
      assert.equal(t.depends_on, undefined);
    }
  });

  it("preserves other dependencies on the dependent when stripping", () => {
    route.init("rm-tack-partial");
    route.addTack("rm-tack-partial", "First");
    route.addTack("rm-tack-partial", "Second");
    route.addTack("rm-tack-partial", "Third", { dependsOn: ["t1", "t2"] });
    const r = route.removeTack("rm-tack-partial", "t1", { force: true });
    const t3 = r.tacks.find((t) => t.id === "t3");
    assert.deepEqual(t3!.depends_on, ["t2"]);
  });
});

describe("pin/unpin", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "tack-pin-"));
  });

  it("readPin returns null when no pin file exists", () => {
    assert.equal(route.readPin(cwd), null);
  });

  it("writePin persists slug + pinned_at", () => {
    route.init("pin-target");
    const pin = route.writePin("pin-target", cwd);
    assert.equal(pin.slug, "pin-target");
    assert.ok(pin.pinned_at);
    const round = route.readPin(cwd);
    assert.equal(round?.slug, "pin-target");
  });

  it("writePin includes session_id from env when set", () => {
    route.init("pin-with-session");
    const prev = process.env.CLAUDE_SESSION_ID;
    process.env.CLAUDE_SESSION_ID = "sess-123";
    try {
      const pin = route.writePin("pin-with-session", cwd);
      assert.equal(pin.session_id, "sess-123");
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_SESSION_ID;
      else process.env.CLAUDE_SESSION_ID = prev;
    }
  });

  it("writePin fails for unknown slug", () => {
    assert.throws(() => route.writePin("does-not-exist", cwd), /not found/i);
  });

  it("deletePin removes the file and returns true", () => {
    route.init("pin-removable");
    route.writePin("pin-removable", cwd);
    assert.equal(route.deletePin(cwd), true);
    assert.equal(route.readPin(cwd), null);
  });

  it("deletePin returns false when no pin exists", () => {
    assert.equal(route.deletePin(cwd), false);
  });

  it("writePin overwrites an existing pin", () => {
    route.init("pin-first");
    route.init("pin-second");
    route.writePin("pin-first", cwd);
    route.writePin("pin-second", cwd);
    assert.equal(route.readPin(cwd)?.slug, "pin-second");
  });
});
