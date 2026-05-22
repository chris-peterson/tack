import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
let route;
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
        assert.throws(() => route.addTack("bad-dep", "Task", { dependsOn: ["t99"] }), /not found/i);
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
        assert.throws(() => route.startTack("start-dep", "t2"), /unmet dependencies/);
    });
    it("allows start when dependencies are done", () => {
        route.init("start-ok");
        route.addTack("start-ok", "First");
        route.addTack("start-ok", "Second", { dependsOn: ["t1"] });
        route.markDone("start-ok", "t1");
        const t = route.startTack("start-ok", "t2");
        assert.equal(t.status, "in_progress");
    });
    it("error points at depends rm and status set", () => {
        route.init("start-err-hint");
        route.addTack("start-err-hint", "First");
        route.addTack("start-err-hint", "Second", { dependsOn: ["t1"] });
        assert.throws(() => route.startTack("start-err-hint", "t2"), /depends rm.*status set/s);
    });
});
describe("setStatus", () => {
    it("writes the status with no guards", () => {
        route.init("set-status");
        route.addTack("set-status", "First");
        route.addTack("set-status", "Second", { dependsOn: ["t1"] });
        const t = route.setStatus("set-status", "t2", "in_progress");
        assert.equal(t.status, "in_progress");
    });
    it("stamps done_at when transitioning to done", () => {
        route.init("set-status-done");
        route.addTack("set-status-done", "Task");
        const t = route.setStatus("set-status-done", "t1", "done");
        assert.equal(t.status, "done");
        assert.ok(t.done_at);
    });
    it("preserves existing done_at on a re-set", () => {
        route.init("set-status-done-keep");
        route.addTack("set-status-done-keep", "Task");
        route.markDone("set-status-done-keep", "t1", { at: "2026-04-30" });
        const t = route.setStatus("set-status-done-keep", "t1", "done");
        assert.equal(t.done_at, "2026-04-30");
    });
    it("supports blocked", () => {
        route.init("set-status-blocked");
        route.addTack("set-status-blocked", "Task");
        const t = route.setStatus("set-status-blocked", "t1", "blocked");
        assert.equal(t.status, "blocked");
    });
    it("throws for missing tack", () => {
        route.init("set-status-bad");
        assert.throws(() => route.setStatus("set-status-bad", "t99", "done"), /not found/i);
    });
});
describe("addDependency", () => {
    it("adds a dependency to a tack", () => {
        route.init("dep-add");
        route.addTack("dep-add", "First");
        route.addTack("dep-add", "Second");
        const t = route.addDependency("dep-add", "t2", "t1");
        assert.deepEqual(t.depends_on, ["t1"]);
    });
    it("is idempotent when the dependency already exists", () => {
        route.init("dep-add-dup");
        route.addTack("dep-add-dup", "First");
        route.addTack("dep-add-dup", "Second", { dependsOn: ["t1"] });
        const t = route.addDependency("dep-add-dup", "t2", "t1");
        assert.deepEqual(t.depends_on, ["t1"]);
    });
    it("rejects self-dependency", () => {
        route.init("dep-add-self");
        route.addTack("dep-add-self", "Task");
        assert.throws(() => route.addDependency("dep-add-self", "t1", "t1"), /self/i);
    });
    it("rejects nonexistent dependency target", () => {
        route.init("dep-add-missing");
        route.addTack("dep-add-missing", "Task");
        assert.throws(() => route.addDependency("dep-add-missing", "t1", "t99"), /not found/i);
    });
    it("rejects a cycle", () => {
        route.init("dep-add-cycle");
        route.addTack("dep-add-cycle", "First");
        route.addTack("dep-add-cycle", "Second", { dependsOn: ["t1"] });
        assert.throws(() => route.addDependency("dep-add-cycle", "t1", "t2"), /circular/i);
    });
});
describe("removeDependency", () => {
    it("removes a dependency from a tack", () => {
        route.init("dep-rm");
        route.addTack("dep-rm", "First");
        route.addTack("dep-rm", "Second", { dependsOn: ["t1"] });
        const t = route.removeDependency("dep-rm", "t2", "t1");
        assert.equal(t.depends_on, undefined);
    });
    it("leaves other deps in place", () => {
        route.init("dep-rm-partial");
        route.addTack("dep-rm-partial", "First");
        route.addTack("dep-rm-partial", "Second");
        route.addTack("dep-rm-partial", "Third", { dependsOn: ["t1", "t2"] });
        const t = route.removeDependency("dep-rm-partial", "t3", "t1");
        assert.deepEqual(t.depends_on, ["t2"]);
    });
    it("throws when the dependency is not set", () => {
        route.init("dep-rm-missing");
        route.addTack("dep-rm-missing", "First");
        route.addTack("dep-rm-missing", "Second");
        assert.throws(() => route.removeDependency("dep-rm-missing", "t2", "t1"), /does not depend on/i);
    });
});
describe("rename", () => {
    it("renames a route file and updates the slug field", () => {
        route.init("rename-src");
        route.addTack("rename-src", "Task");
        const r = route.rename("rename-src", "rename-dst");
        assert.equal(r.slug, "rename-dst");
        const reloaded = route.load("rename-dst");
        assert.equal(reloaded.slug, "rename-dst");
        assert.equal(reloaded.tacks.length, 1);
        assert.throws(() => route.load("rename-src"), /not found/i);
    });
    it("preserves the route id across rename", () => {
        route.init("rename-id-src");
        const original = route.load("rename-id-src");
        route.rename("rename-id-src", "rename-id-dst");
        const renamed = route.load("rename-id-dst");
        assert.equal(renamed.id, original.id);
    });
    it("refuses if the destination already exists", () => {
        route.init("rename-collide-src");
        route.init("rename-collide-dst");
        assert.throws(() => route.rename("rename-collide-src", "rename-collide-dst"), /already exists/);
    });
    it("refuses if the source does not exist", () => {
        assert.throws(() => route.rename("ghost-src", "ghost-dst"), /not found/i);
    });
    it("refuses if old and new slug match", () => {
        route.init("rename-noop");
        assert.throws(() => route.rename("rename-noop", "rename-noop"), /same/i);
    });
    it("refuses when another route's depends_on references the old slug", async () => {
        const { writeFileSync, readFileSync } = await import("node:fs");
        const yaml = await import("yaml");
        route.init("rename-target");
        route.init("rename-referer");
        const refererPath = join(tmp, "routes", "rename-referer.yaml");
        const data = yaml.parse(readFileSync(refererPath, "utf-8"));
        data.depends_on = ["rename-target"];
        writeFileSync(refererPath, yaml.stringify(data), "utf-8");
        assert.throws(() => route.rename("rename-target", "rename-target-new"), /referenced by rename-referer/);
    });
});
describe("markDone", () => {
    it("marks tack as done with an ISO date-time", () => {
        route.init("done-test");
        route.addTack("done-test", "Task");
        const { tack } = route.markDone("done-test", "t1");
        assert.equal(tack.status, "done");
        assert.match(tack.done_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
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
        assert.throws(() => route.markDone("done-backfill-bad", "t1", { at: "not-a-date" }), /Invalid timestamp/);
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
        assert.match(t.done_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
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
        assert.equal(t.deliverable.url, "https://github.com/owner/repo/pull/42");
        assert.equal(t.deliverable.label, "repo #42");
    });
    it("rejects an invalid doneAt", () => {
        route.init("add-done-bad");
        assert.throws(() => route.addTack("add-done-bad", "Task", { done: true, doneAt: "yesterday" }), /Invalid timestamp/);
    });
});
describe("deriveDeliverableLabel", () => {
    it("parses GitHub PR URLs", () => {
        assert.equal(route.deriveDeliverableLabel("https://github.com/owner/repo/pull/42"), "repo #42");
    });
    it("parses GitHub issue URLs", () => {
        assert.equal(route.deriveDeliverableLabel("https://github.com/owner/repo/issues/7"), "repo #7");
    });
    it("parses GitLab MR URLs", () => {
        assert.equal(route.deriveDeliverableLabel("https://gitlab.example.com/group/sub/repo/-/merge_requests/99"), "repo !99");
    });
    it("parses GitLab issue URLs", () => {
        assert.equal(route.deriveDeliverableLabel("https://gitlab.example.com/group/repo/-/issues/12"), "repo #12");
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
        assert.equal(t.deliverable.label, "PR #42");
        assert.equal(t.deliverable.url, "https://github.com/pr/42");
    });
    it("refuses to overwrite an existing deliverable without force", () => {
        route.init("dlv-protected");
        route.addTack("dlv-protected", "Task");
        route.setDeliverable("dlv-protected", "t1", "PR #1", "https://github.com/pr/1");
        assert.throws(() => route.setDeliverable("dlv-protected", "t1", "PR #2", "https://github.com/pr/2"), /already has a deliverable/);
        const t = route.load("dlv-protected").tacks[0];
        assert.equal(t.deliverable.url, "https://github.com/pr/1");
    });
    it("overwrites existing deliverable with force", () => {
        route.init("dlv-force");
        route.addTack("dlv-force", "Task");
        route.setDeliverable("dlv-force", "t1", "PR #1", "https://github.com/pr/1");
        const t = route.setDeliverable("dlv-force", "t1", "PR #2", "https://github.com/pr/2", { force: true });
        assert.equal(t.deliverable.label, "PR #2");
    });
    it("strips a matching link when the URL is also present in links", () => {
        route.init("dlv-strip");
        route.addTack("dlv-strip", "Task");
        route.addLink("dlv-strip", "t1", "PR A", "https://github.com/acme/repo/pull/1");
        route.addLink("dlv-strip", "t1", "Design", "https://example.com/design");
        const t = route.setDeliverable("dlv-strip", "t1", "PR A", "https://github.com/acme/repo/pull/1");
        assert.equal(t.deliverable.url, "https://github.com/acme/repo/pull/1");
        assert.equal(t.links.length, 1);
        assert.equal(t.links[0].url, "https://example.com/design");
    });
    it("deletes the links field when stripping leaves it empty", () => {
        route.init("dlv-strip-empty");
        route.addTack("dlv-strip-empty", "Task");
        route.addLink("dlv-strip-empty", "t1", "PR A", "https://github.com/acme/repo/pull/1");
        const t = route.setDeliverable("dlv-strip-empty", "t1", "PR A", "https://github.com/acme/repo/pull/1");
        assert.equal(t.deliverable.url, "https://github.com/acme/repo/pull/1");
        assert.equal(t.links, undefined);
    });
});
describe("addBefore", () => {
    it("adds a before todo with sequential ids", () => {
        route.init("before-test");
        route.addTack("before-test", "Task");
        const t1 = route.addBefore("before-test", "t1", "Read the docs");
        assert.equal(t1.before.length, 1);
        assert.equal(t1.before[0].id, "b1");
        assert.equal(t1.before[0].text, "Read the docs");
        assert.equal(t1.before[0].done, false);
        const t2 = route.addBefore("before-test", "t1", "Set up env");
        assert.equal(t2.before.length, 2);
        assert.equal(t2.before[1].id, "b2");
    });
});
describe("addAfter", () => {
    it("adds an after todo with sequential ids", () => {
        route.init("after-test");
        route.addTack("after-test", "Task");
        const t1 = route.addAfter("after-test", "t1", "Notify team");
        assert.equal(t1.after.length, 1);
        assert.equal(t1.after[0].id, "a1");
        assert.equal(t1.after[0].text, "Notify team");
        assert.equal(t1.after[0].done, false);
        const t2 = route.addAfter("after-test", "t1", "Update docs");
        assert.equal(t2.after.length, 2);
        assert.equal(t2.after[1].id, "a2");
    });
});
describe("completeTodo", () => {
    it("marks a before todo as done with date", () => {
        route.init("todo-done-b");
        route.addTack("todo-done-b", "Task");
        route.addBefore("todo-done-b", "t1", "Prereq");
        const t = route.completeTodo("todo-done-b", "t1", "b1");
        assert.equal(t.before[0].done, true);
        assert.ok(t.before[0].done_at);
    });
    it("marks an after todo as done with date", () => {
        route.init("todo-done-a");
        route.addTack("todo-done-a", "Task");
        route.addAfter("todo-done-a", "t1", "Follow up");
        const t = route.completeTodo("todo-done-a", "t1", "a1");
        assert.equal(t.after[0].done, true);
        assert.ok(t.after[0].done_at);
    });
    it("throws for nonexistent todo", () => {
        route.init("todo-done-bad");
        route.addTack("todo-done-bad", "Task");
        assert.throws(() => route.completeTodo("todo-done-bad", "t1", "b1"), /not found/i);
    });
});
describe("dropTodo", () => {
    it("removes a before todo", () => {
        route.init("todo-drop-b");
        route.addTack("todo-drop-b", "Task");
        route.addBefore("todo-drop-b", "t1", "Will remove");
        route.addBefore("todo-drop-b", "t1", "Will keep");
        const t = route.dropTodo("todo-drop-b", "t1", "b1");
        assert.equal(t.before.length, 1);
        assert.equal(t.before[0].id, "b2");
    });
    it("removes an after todo", () => {
        route.init("todo-drop-a");
        route.addTack("todo-drop-a", "Task");
        route.addAfter("todo-drop-a", "t1", "Will remove");
        const t = route.dropTodo("todo-drop-a", "t1", "a1");
        assert.equal(t.after.length, 0);
    });
    it("throws for nonexistent todo", () => {
        route.init("todo-drop-bad");
        route.addTack("todo-drop-bad", "Task");
        assert.throws(() => route.dropTodo("todo-drop-bad", "t1", "a99"), /not found/i);
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
        assert.equal(t.before.length, 1);
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
        assert.equal(t.before.length, 1);
        assert.equal(t.before[0].id, "b1");
        assert.equal(t.before[0].text, "Source prereq");
        assert.equal(t.after.length, 1);
        assert.equal(t.after[0].text, "Source followup");
        assert.equal(t.links.length, 1);
        assert.equal(t.links[0].label, "Doc");
        const r = route.load("merge-test");
        const source = r.tacks.find((t) => t.id === "t2");
        assert.equal(source.status, "dropped");
    });
    it("moves deliverable from source when target has none", () => {
        route.init("merge-dlv");
        route.addTack("merge-dlv", "Target");
        route.addTack("merge-dlv", "Source");
        route.setDeliverable("merge-dlv", "t2", "PR #5", "https://github.com/acme/repo/pull/5");
        const t = route.mergeTacks("merge-dlv", "t2", "t1");
        assert.equal(t.deliverable.label, "PR #5");
    });
    it("keeps target deliverable when both have one", () => {
        route.init("merge-dlv-both");
        route.addTack("merge-dlv-both", "Target");
        route.addTack("merge-dlv-both", "Source");
        route.setDeliverable("merge-dlv-both", "t1", "Target PR", "https://github.com/acme/repo/pull/1");
        route.setDeliverable("merge-dlv-both", "t2", "Source PR", "https://github.com/acme/repo/pull/2");
        const t = route.mergeTacks("merge-dlv-both", "t2", "t1");
        assert.equal(t.deliverable.label, "Target PR");
    });
    it("re-IDs todos to avoid conflicts", () => {
        route.init("merge-reids");
        route.addTack("merge-reids", "Target");
        route.addTack("merge-reids", "Source");
        route.addBefore("merge-reids", "t1", "Target prereq");
        route.addBefore("merge-reids", "t2", "Source prereq");
        const t = route.mergeTacks("merge-reids", "t2", "t1");
        assert.equal(t.before.length, 2);
        assert.equal(t.before[0].id, "b1");
        assert.equal(t.before[1].id, "b2");
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
        assert.equal(t.links.length, 1);
        assert.equal(t.links[0].label, "Design doc");
        assert.equal(t.links[0].url, "https://example.com/design");
    });
    it("does not promote a GitHub PR link to deliverable by default", () => {
        route.init("link-pr-no-promote");
        route.addTack("link-pr-no-promote", "Task");
        const t = route.addLink("link-pr-no-promote", "t1", "My PR", "https://github.com/acme/repo/pull/42");
        assert.equal(t.deliverable, undefined);
        assert.equal(t.links.length, 1);
        assert.equal(t.links[0].url, "https://github.com/acme/repo/pull/42");
    });
    it("does not promote a GitLab MR link to deliverable by default", () => {
        route.init("link-mr-no-promote");
        route.addTack("link-mr-no-promote", "Task");
        const t = route.addLink("link-mr-no-promote", "t1", "My MR", "https://gitlab.example.com/group/proj/-/merge_requests/99");
        assert.equal(t.deliverable, undefined);
        assert.equal(t.links.length, 1);
        assert.equal(t.links[0].url, "https://gitlab.example.com/group/proj/-/merge_requests/99");
    });
    it("adds a PR link alongside an existing deliverable", () => {
        route.init("link-pr-existing");
        route.addTack("link-pr-existing", "Task");
        route.setDeliverable("link-pr-existing", "t1", "First PR", "https://github.com/acme/repo/pull/1");
        const t = route.addLink("link-pr-existing", "t1", "Second PR", "https://github.com/acme/repo/pull/2");
        assert.equal(t.deliverable.url, "https://github.com/acme/repo/pull/1");
        assert.equal(t.links.length, 1);
        assert.equal(t.links[0].url, "https://github.com/acme/repo/pull/2");
    });
    it("is idempotent when the url already exists in links", () => {
        route.init("link-dup");
        route.addTack("link-dup", "Task");
        route.addLink("link-dup", "t1", "Doc", "https://example.com/doc");
        const t = route.addLink("link-dup", "t1", "Doc v2", "https://example.com/doc");
        assert.equal(t.links.length, 1);
        assert.equal(t.links[0].label, "Doc");
    });
    it("is idempotent when the url already matches the deliverable", () => {
        route.init("link-dup-deliverable");
        route.addTack("link-dup-deliverable", "Task");
        route.setDeliverable("link-dup-deliverable", "t1", "PR", "https://github.com/acme/repo/pull/1");
        const t = route.addLink("link-dup-deliverable", "t1", "Same PR", "https://github.com/acme/repo/pull/1");
        assert.equal(t.deliverable.label, "PR");
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
        assert.equal(t.links.length, 1);
        assert.equal(t.links[0].url, "https://example.com/b");
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
        assert.throws(() => route.removeLink("link-rm-missing", "t1", "https://example.com/missing"), /No link with url/);
    });
});
describe("markDone deliverable promotion", () => {
    it("promotes a PR link when no deliverable is set", () => {
        route.init("done-promote");
        route.addTack("done-promote", "Task");
        route.addLink("done-promote", "t1", "Docs", "https://example.com/docs");
        route.addLink("done-promote", "t1", "The PR", "https://github.com/acme/repo/pull/7");
        const { tack } = route.markDone("done-promote", "t1");
        assert.ok(tack.deliverable);
        assert.equal(tack.deliverable.url, "https://github.com/acme/repo/pull/7");
        assert.equal(tack.links.length, 1);
        assert.equal(tack.links[0].label, "Docs");
    });
    it("does not overwrite existing deliverable on done", () => {
        route.init("done-no-overwrite");
        route.addTack("done-no-overwrite", "Task");
        route.setDeliverable("done-no-overwrite", "t1", "Original", "https://github.com/acme/repo/pull/1");
        route.addLink("done-no-overwrite", "t1", "Other PR", "https://github.com/acme/repo/pull/2");
        const { tack, ambiguousDeliverable } = route.markDone("done-no-overwrite", "t1");
        assert.equal(tack.deliverable.url, "https://github.com/acme/repo/pull/1");
        assert.deepEqual(ambiguousDeliverable, []);
    });
    it("refuses to pick when two or more PR/MR links are present", () => {
        route.init("done-ambiguous");
        route.addTack("done-ambiguous", "Task");
        route.addLink("done-ambiguous", "t1", "PR A", "https://github.com/acme/repo/pull/1");
        route.addLink("done-ambiguous", "t1", "PR B", "https://github.com/acme/repo/pull/2");
        const { tack, ambiguousDeliverable } = route.markDone("done-ambiguous", "t1");
        assert.equal(tack.status, "done");
        assert.equal(tack.deliverable, undefined);
        assert.equal(ambiguousDeliverable.length, 2);
        assert.equal(ambiguousDeliverable[0].url, "https://github.com/acme/repo/pull/1");
        assert.equal(ambiguousDeliverable[1].url, "https://github.com/acme/repo/pull/2");
        assert.equal(tack.links.length, 2);
    });
    it("returns an empty ambiguousDeliverable when promotion succeeds", () => {
        route.init("done-single");
        route.addTack("done-single", "Task");
        route.addLink("done-single", "t1", "Only PR", "https://github.com/acme/repo/pull/9");
        const { ambiguousDeliverable } = route.markDone("done-single", "t1");
        assert.deepEqual(ambiguousDeliverable, []);
    });
});
describe("recordSession", () => {
    it("adds a session to a route", () => {
        route.init("session-test");
        const r = route.recordSession("session-test", "session_abc123");
        assert.equal(r.sessions.length, 1);
        assert.equal(r.sessions[0].id, "session_abc123");
        assert.ok(r.sessions[0].started_at);
    });
    it("does not duplicate an existing session and preserves original timestamp", () => {
        route.init("session-dedup");
        const r1 = route.recordSession("session-dedup", "session_abc123");
        const originalStartedAt = r1.sessions[0].started_at;
        const r2 = route.recordSession("session-dedup", "session_abc123");
        assert.equal(r2.sessions.length, 1);
        assert.equal(r2.sessions[0].started_at, originalStartedAt);
    });
    it("appends multiple distinct sessions", () => {
        route.init("session-multi");
        route.recordSession("session-multi", "session_aaa");
        const r = route.recordSession("session-multi", "session_bbb");
        assert.equal(r.sessions.length, 2);
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
        assert.throws(() => route.removeTack("rm-tack-dep", "t1"), /depended on by t2/);
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
        assert.deepEqual(t3.depends_on, ["t2"]);
    });
});
describe("pin/unpin", () => {
    let cwd;
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
        }
        finally {
            if (prev === undefined)
                delete process.env.CLAUDE_SESSION_ID;
            else
                process.env.CLAUDE_SESSION_ID = prev;
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
describe("moveTack", () => {
    it("moves a tack and preserves all metadata", () => {
        route.init("move-src");
        route.init("move-dst");
        route.addTack("move-src", "Original task");
        route.setDeliverable("move-src", "t1", "PR #5", "https://github.com/acme/repo/pull/5");
        route.addLink("move-src", "t1", "Design", "https://example.com/design");
        route.addBefore("move-src", "t1", "Read the spec");
        route.addAfter("move-src", "t1", "Update docs");
        route.startTack("move-src", "t1");
        const result = route.moveTack("move-src", "t1", "move-dst");
        assert.equal(result.moved.length, 1);
        assert.equal(result.moved[0].srcId, "t1");
        assert.equal(result.moved[0].dstId, "t1");
        const src = route.load("move-src");
        assert.equal(src.tacks.length, 0);
        const dst = route.load("move-dst");
        assert.equal(dst.tacks.length, 1);
        const moved = dst.tacks[0];
        assert.equal(moved.summary, "Original task");
        assert.equal(moved.status, "in_progress");
        assert.equal(moved.deliverable.url, "https://github.com/acme/repo/pull/5");
        assert.equal(moved.links.length, 1);
        assert.equal(moved.links[0].url, "https://example.com/design");
        assert.equal(moved.before.length, 1);
        assert.equal(moved.before[0].text, "Read the spec");
        assert.equal(moved.after.length, 1);
        assert.equal(moved.after[0].text, "Update docs");
    });
    it("assigns the next sequential id in the destination", () => {
        route.init("move-src-2");
        route.init("move-dst-2");
        route.addTack("move-dst-2", "Existing task");
        route.addTack("move-src-2", "Incoming task");
        const result = route.moveTack("move-src-2", "t1", "move-dst-2");
        assert.equal(result.moved[0].dstId, "t2");
        const dst = route.load("move-dst-2");
        assert.equal(dst.tacks.length, 2);
        assert.equal(dst.tacks[1].id, "t2");
        assert.equal(dst.tacks[1].summary, "Incoming task");
    });
    it("refuses when src tack has an outgoing depends_on edge", () => {
        route.init("move-out-src");
        route.init("move-out-dst");
        route.addTack("move-out-src", "First");
        route.addTack("move-out-src", "Second", { dependsOn: ["t1"] });
        assert.throws(() => route.moveTack("move-out-src", "t2", "move-out-dst"), (err) => {
            assert.match(err.message, /depends_on edges cross the route boundary/);
            assert.doesNotMatch(err.message, /--include-dependents/);
            return true;
        });
        assert.equal(route.load("move-out-src").tacks.length, 2);
        assert.equal(route.load("move-out-dst").tacks.length, 0);
    });
    it("refuses when src tack has an incoming depends_on edge and hints --include-dependents", () => {
        route.init("move-in-src");
        route.init("move-in-dst");
        route.addTack("move-in-src", "Foundation");
        route.addTack("move-in-src", "Depends on foundation", { dependsOn: ["t1"] });
        assert.throws(() => route.moveTack("move-in-src", "t1", "move-in-dst"), (err) => {
            assert.match(err.message, /depends_on edges cross the route boundary/);
            assert.match(err.message, /--include-dependents/);
            return true;
        });
        assert.equal(route.load("move-in-src").tacks.length, 2);
        assert.equal(route.load("move-in-dst").tacks.length, 0);
    });
    it("does not hint --include-dependents when both outgoing and incoming edges exist", () => {
        route.init("move-middle-src");
        route.init("move-middle-dst");
        route.addTack("move-middle-src", "Root");
        route.addTack("move-middle-src", "Middle", { dependsOn: ["t1"] });
        route.addTack("move-middle-src", "Leaf", { dependsOn: ["t2"] });
        assert.throws(() => route.moveTack("move-middle-src", "t2", "move-middle-dst"), (err) => {
            assert.match(err.message, /depends_on edges cross the route boundary/);
            assert.doesNotMatch(err.message, /--include-dependents/);
            return true;
        });
    });
    it("--include-dependents moves the dependent chain and remaps ids", () => {
        route.init("move-chain-src");
        route.init("move-chain-dst");
        route.addTack("move-chain-src", "Root");
        route.addTack("move-chain-src", "Middle", { dependsOn: ["t1"] });
        route.addTack("move-chain-src", "Leaf", { dependsOn: ["t2"] });
        const result = route.moveTack("move-chain-src", "t1", "move-chain-dst", {
            includeDependents: true,
        });
        assert.equal(result.moved.length, 3);
        const src = route.load("move-chain-src");
        assert.equal(src.tacks.length, 0);
        const dst = route.load("move-chain-dst");
        assert.equal(dst.tacks.length, 3);
        const root = dst.tacks.find((t) => t.summary === "Root");
        const middle = dst.tacks.find((t) => t.summary === "Middle");
        const leaf = dst.tacks.find((t) => t.summary === "Leaf");
        assert.deepEqual(middle.depends_on, [root.id]);
        assert.deepEqual(leaf.depends_on, [middle.id]);
    });
    it("--include-dependents still refuses if a staying tack depends on a moving tack", () => {
        route.init("move-partial-src");
        route.init("move-partial-dst");
        route.addTack("move-partial-src", "Root");
        route.addTack("move-partial-src", "Middle", { dependsOn: ["t1"] });
        route.addTack("move-partial-src", "Sibling", { dependsOn: ["t1"] });
        assert.throws(() => route.moveTack("move-partial-src", "t2", "move-partial-dst", {
            includeDependents: true,
        }), /depends_on edges cross the route boundary/);
    });
    it("refuses when src and dst are the same route", () => {
        route.init("move-same");
        route.addTack("move-same", "Task");
        assert.throws(() => route.moveTack("move-same", "t1", "move-same"), /Source and destination routes are the same/);
    });
    it("throws when source route does not exist", () => {
        route.init("move-only-dst");
        assert.throws(() => route.moveTack("missing-src", "t1", "move-only-dst"), /not found/i);
    });
    it("throws when destination route does not exist", () => {
        route.init("move-only-src");
        route.addTack("move-only-src", "Task");
        assert.throws(() => route.moveTack("move-only-src", "t1", "missing-dst"), /not found/i);
    });
    it("throws when source tack does not exist", () => {
        route.init("move-no-tack-src");
        route.init("move-no-tack-dst");
        assert.throws(() => route.moveTack("move-no-tack-src", "t99", "move-no-tack-dst"), /Tack not found/);
    });
});
