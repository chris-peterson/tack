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
