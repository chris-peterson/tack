import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
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

describe("tack group (issue #19)", () => {
  it("sets a group on an existing route", () => {
    runFail(["init", "grp-set"]);
    const r = runFail(["group", "grp-set", "platform"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /group: platform/);
  });

  it("changes the group on an already-grouped route", () => {
    runFail(["init", "grp-change", "--group", "old"]);
    const r = runFail(["group", "grp-change", "new"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /group: new/);
  });

  it("clears the group with --clear", () => {
    runFail(["init", "grp-clear", "--group", "temp"]);
    const r = runFail(["group", "grp-clear", "--clear"]);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /group: temp/);
  });

  it("prints the current group when no group argument is given", () => {
    runFail(["init", "grp-show", "--group", "infra"]);
    const r = runFail(["group", "grp-show"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "infra");
  });

  it("exits non-zero when reporting an ungrouped route", () => {
    runFail(["init", "grp-none"]);
    const r = runFail(["group", "grp-none"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no group set on grp-none/);
  });

  it("fails on a group slug that violates the schema pattern", () => {
    runFail(["init", "grp-bad"]);
    const r = runFail(["group", "grp-bad", "Not A Slug"]);
    assert.equal(r.status, 1);
  });
});

describe("tack repo (CL-42..46)", () => {
  it("captures a repo from a deliverable and looks it up by partial name", () => {
    runFail(["init", "repo-cap"]);
    runFail(["add", "repo-cap", "Work"]);
    runFail(["deliverable", "repo-cap", "t1", "https://github.com/chris-peterson/zonker/pull/3"]);
    const r = runFail(["repo", "zonk"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "https://github.com/chris-peterson/zonker");
  });

  it("exits non-zero when no repo matches", () => {
    const r = runFail(["repo", "no-such-repo-xyz"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No repo matches/);
  });

  it("adds an alias that lookup then resolves", () => {
    runFail(["init", "repo-alias"]);
    runFail(["add", "repo-alias", "Work"]);
    runFail(["deliverable", "repo-alias", "t1", "https://github.com/chris-peterson/quux/pull/1"]);
    runFail(["repo", "alias", "quux", "qx"]);
    const r = runFail(["repo", "qx"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "https://github.com/chris-peterson/quux");
  });

  it("emits structured output with --json", () => {
    runFail(["init", "repo-json"]);
    runFail(["add", "repo-json", "Work"]);
    runFail(["deliverable", "repo-json", "t1", "https://github.com/chris-peterson/jsonrepo/pull/1"]);
    const r = runFail(["repo", "jsonrepo", "--json"]);
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed[0].url, "https://github.com/chris-peterson/jsonrepo");
  });

  it("captures the repo from add --deliverable (RP-06)", () => {
    runFail(["init", "repo-add"]);
    runFail([
      "add", "repo-add", "Work",
      "--deliverable", "https://github.com/chris-peterson/addcap/pull/1",
    ]);
    const r = runFail(["repo", "addcap"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "https://github.com/chris-peterson/addcap");
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

describe("tack start auto-binds the current Claude session (beacon fleet join)", () => {
  it("records the session with the started tack under sessions[]", () => {
    const home = mkdtempSync(join(tmpdir(), "tack-start-bind-"));
    const e = { ...process.env, TACK_HOME: home, CLAUDE_CODE_SESSION_ID: "sess-abc-123" };
    execFileSync("node", [cli, "init", "bindroute"], { env: e });
    execFileSync("node", [cli, "add", "bindroute", "Wire it"], { env: e });
    execFileSync("node", [cli, "start", "bindroute", "t1"], { env: e });
    const yaml = readFileSync(join(home, "routes", "bindroute.yaml"), "utf-8");
    assert.match(yaml, /sessions:/);
    assert.match(yaml, /- id: sess-abc-123/);
    assert.match(yaml, /tacks:\s*\n\s*- t1/);
  });

  it("is a no-op outside a Claude session (env var unset)", () => {
    const home = mkdtempSync(join(tmpdir(), "tack-start-nobind-"));
    const e: NodeJS.ProcessEnv = { ...process.env, TACK_HOME: home };
    delete e.CLAUDE_CODE_SESSION_ID;
    execFileSync("node", [cli, "init", "nobind"], { env: e });
    execFileSync("node", [cli, "add", "nobind", "Wire it"], { env: e });
    execFileSync("node", [cli, "start", "nobind", "t1"], { env: e });
    const yaml = readFileSync(join(home, "routes", "nobind.yaml"), "utf-8");
    assert.doesNotMatch(yaml, /sessions:/);
  });
});
