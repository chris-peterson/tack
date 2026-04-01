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

  it("creates a planned route by default (no origin field)", () => {
    const r = route.init("planned-default");
    assert.equal(r.origin, undefined);
  });

  it("creates a tangent route when origin is tangent", () => {
    const r = route.init("my-tangent", { origin: "tangent" });
    assert.equal(r.origin, "tangent");
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

  it("supports project option", () => {
    route.init("opts-test");
    const t = route.addTack("opts-test", "With opts", {
      project: "my-repo",
    });
    assert.equal(t.project, "my-repo");
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
  it("marks tack as done with date", () => {
    route.init("done-test");
    route.addTack("done-test", "Task");
    const { tack } = route.markDone("done-test", "t1");
    assert.equal(tack.status, "done");
    assert.ok(tack.done_at);
  });

  it("returns pending after items", () => {
    route.init("done-after");
    route.addTack("done-after", "Task");
    route.addAfter("done-after", "t1", "Deploy to prod");
    const { pendingTodo } = route.markDone("done-after", "t1");
    assert.deepEqual(pendingTodo, ["Deploy to prod"]);
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

  it("overwrites existing deliverable", () => {
    route.init("dlv-overwrite");
    route.addTack("dlv-overwrite", "Task");
    route.setDeliverable("dlv-overwrite", "t1", "PR #1", "https://github.com/pr/1");
    const t = route.setDeliverable("dlv-overwrite", "t1", "PR #2", "https://github.com/pr/2");
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

describe("addLink", () => {
  it("adds a link to a tack", () => {
    route.init("link-test");
    route.addTack("link-test", "Task");
    const t = route.addLink("link-test", "t1", "Design doc", "https://example.com/design");
    assert.equal(t.links!.length, 1);
    assert.equal(t.links![0].label, "Design doc");
    assert.equal(t.links![0].url, "https://example.com/design");
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

  it("does not duplicate an existing session", () => {
    route.init("session-dedup");
    route.recordSession("session-dedup", "session_abc123");
    const r = route.recordSession("session-dedup", "session_abc123");
    assert.equal(r.sessions!.length, 1);
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
