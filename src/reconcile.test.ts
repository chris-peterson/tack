import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let route: typeof import("./route.js");
let reconcile: typeof import("./reconcile.js");

const tmp = mkdtempSync(join(tmpdir(), "tack-reconcile-test-"));
process.env.TACK_HOME = tmp;

const MERGED_AT = "2026-04-10T20:44:01.323Z";
const PR = "https://github.com/o/r/pull/7";

// The probe stands in for the forge so the suite never opens a socket. The
// production default is `mergeState`, which shells out to gh/glab.
const allMerged = () => ({ merged: true, mergedAt: MERGED_AT });
const noneMerged = () => ({ merged: false });

before(async () => {
  route = await import("./route.js");
  reconcile = await import("./reconcile.js");
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(tmp, "routes"), { recursive: true, force: true });
});

describe("reconcile", () => {
  it("closes an open tack whose deliverable merged, stamping the merge time", () => {
    route.init("rec-merged");
    route.addTack("rec-merged", "work", { deliverable: { label: "r#7", url: PR } });

    const closed = reconcile.reconcile({ probe: allMerged });

    assert.equal(closed.length, 1);
    assert.equal(closed[0].tackId, "t1");
    const tack = route.load("rec-merged").tacks[0];
    assert.equal(tack.status, "done");
    assert.equal(tack.done_at, MERGED_AT);
  });

  it("leaves an unmerged deliverable open", () => {
    route.init("rec-open");
    route.addTack("rec-open", "work", { deliverable: { label: "r#7", url: PR } });

    assert.equal(reconcile.reconcile({ probe: noneMerged }).length, 0);
    assert.equal(route.load("rec-open").tacks[0].status, "pending");
  });

  it("does not ask about a tack with no deliverable", () => {
    route.init("rec-bare");
    route.addTack("rec-bare", "work");

    const probe = () => {
      throw new Error("probed a tack with no deliverable");
    };
    assert.equal(reconcile.reconcile({ probe }).length, 0);
  });

  it("does not ask about a deliverable that cannot merge", () => {
    route.init("rec-issue");
    route.addTack("rec-issue", "work", {
      deliverable: { label: "r#7", url: "https://github.com/o/r/issues/7" },
    });

    const probe = () => {
      throw new Error("probed an issue URL");
    };
    assert.equal(reconcile.reconcile({ probe }).length, 0);
  });

  it("does not ask about a tack that is already done", () => {
    route.init("rec-done");
    route.addTack("rec-done", "work", { done: true, deliverable: { label: "r#7", url: PR } });

    const probe = () => {
      throw new Error("probed a closed tack");
    };
    assert.equal(reconcile.reconcile({ probe }).length, 0);
  });

  it("reports without writing under dry-run", () => {
    route.init("rec-dry");
    route.addTack("rec-dry", "work", { deliverable: { label: "r#7", url: PR } });

    assert.equal(reconcile.reconcile({ probe: allMerged, dryRun: true }).length, 1);
    assert.equal(route.load("rec-dry").tacks[0].status, "pending");
  });

  it("stays inside the named route", () => {
    route.init("rec-named");
    route.addTack("rec-named", "work", { deliverable: { label: "r#7", url: PR } });
    route.init("rec-other");
    route.addTack("rec-other", "work", { deliverable: { label: "r#8", url: PR } });

    const closed = reconcile.reconcile({ slug: "rec-named", probe: allMerged });

    assert.equal(closed.length, 1);
    assert.equal(route.load("rec-other").tacks[0].status, "pending");
  });

  it("refuses a URL from a forge it cannot read", () => {
    assert.throws(
      () => reconcile.mergeState("https://example.com/o/r/pull/7"),
      /does not know how to read/,
    );
  });
});
