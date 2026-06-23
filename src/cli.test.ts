import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const cli = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
const env = { ...process.env, TACK_HOME: mkdtempSync(join(tmpdir(), "tack-cli-test-")) };

function runFail(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [cli, ...args], { env, encoding: "utf-8" });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number; stdout?: string; stderr?: string };
    return { status: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("subcommand-group errors (issue #17)", () => {
  it("link without add/rm names the problem on stderr, not stdout", () => {
    const r = runFail(["link", "my-slug", "t1", "label", "url"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /tack link: expected 'add' or 'rm' \(got 'my-slug'\)/);
  });

  it("depends without add/rm names the problem", () => {
    const r = runFail(["depends", "oops"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /tack depends: expected 'add' or 'rm'/);
  });

  it("todo without done/rm names the problem", () => {
    const r = runFail(["todo", "oops"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /tack todo: expected 'done' or 'rm'/);
  });

  it("status set with missing args names the problem", () => {
    const r = runFail(["status", "set", "some-slug"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /tack status set:/);
  });
});

describe("tack deliverable url-only form (issue #11)", () => {
  it("auto-derives the label when no label is given", () => {
    runFail(["init", "dlv-derive"]);
    runFail(["add", "dlv-derive", "Work"]);
    const r = runFail([
      "deliverable", "dlv-derive", "t1",
      "https://github.com/owner/repo/pull/5",
    ]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /repo#5/);
  });

  it("uses --label to override the derived label", () => {
    runFail(["init", "dlv-explicit"]);
    runFail(["add", "dlv-explicit", "Work"]);
    const r = runFail([
      "deliverable", "dlv-explicit", "t1",
      "https://github.com/owner/repo/pull/5", "--label", "Custom label",
    ]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Custom label/);
  });

  it("rejects the legacy positional-label form", () => {
    runFail(["init", "dlv-legacy"]);
    runFail(["add", "dlv-legacy", "Work"]);
    const r = runFail([
      "deliverable", "dlv-legacy", "t1",
      "Custom label", "https://github.com/owner/repo/pull/5",
    ]);
    assert.equal(r.status, 1);
  });
});

describe("tack accepts bare tack ids (issue #11)", () => {
  it("resolves a bare id through the CLI", () => {
    runFail(["init", "bare-cli"]);
    runFail(["add", "bare-cli", "Work"]);
    const r = runFail(["done", "bare-cli", "1"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[x\] t1/);
  });
});

describe("tack session --tack binds the session to a tack", () => {
  it("records the binding and surfaces it in the route output", () => {
    runFail(["init", "sess-cli"]);
    runFail(["add", "sess-cli", "Work"]);
    const r = runFail(["session", "sess-cli", "claude-abcdef12", "--tack", "t1"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /claude-a → t1/);
  });

  it("records the session with no binding when --tack is omitted", () => {
    runFail(["init", "sess-cli-plain"]);
    const r = runFail(["session", "sess-cli-plain", "claude-xyz"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /sessions: 1/);
  });

  it("fails when --tack names a tack that does not exist", () => {
    runFail(["init", "sess-cli-bad"]);
    const r = runFail(["session", "sess-cli-bad", "claude-xyz", "--tack", "t9"]);
    assert.equal(r.status, 1);
  });
});

describe("--help after a subcommand shows usage", () => {
  it("session --help prints usage and exits 0 instead of crashing", () => {
    const r = runFail(["session", "--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  });

  it("pins --help prints usage instead of silently listing pins", () => {
    const r = runFail(["pins", "--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
    // The arrow only appears in actual pin listings (formatPins), so its
    // absence confirms usage was shown rather than the command running.
    assert.doesNotMatch(r.stdout, /→/);
  });

  it("init --help prints usage and exits 0", () => {
    const r = runFail(["init", "--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  });

  it("-h is honored as a short alias", () => {
    const r = runFail(["session", "-h"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
  });
});
