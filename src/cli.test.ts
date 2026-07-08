import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";

const cli = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
const env: NodeJS.ProcessEnv = { ...process.env, TACK_HOME: mkdtempSync(join(tmpdir(), "tack-cli-test-")) };
// Strip the ambient session id so the suite behaves the same inside a Claude
// session as outside it — otherwise `init`/`add`/`start` would record the
// runner's own session and inflate sessions[] in tests that never set it.
delete env.CLAUDE_CODE_SESSION_ID;

function runFail(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [cli, ...args], { env, encoding: "utf-8" });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number; stdout?: string; stderr?: string };
    return { status: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

// Captures stderr regardless of exit code — runFail discards it on success,
// which hides warnings emitted by commands that still exit 0.
function runCapture(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("node", [cli, ...args], { env, encoding: "utf-8" });
  return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
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

describe("route/tack creation records the current Claude session", () => {
  it("tack init records the session on the new route (route-level, no tack)", () => {
    const home = mkdtempSync(join(tmpdir(), "tack-init-sess-"));
    const e = { ...process.env, TACK_HOME: home, CLAUDE_CODE_SESSION_ID: "sess-init-1" };
    execFileSync("node", [cli, "init", "initroute"], { env: e });
    const yaml = readFileSync(join(home, "routes", "initroute.yaml"), "utf-8");
    assert.match(yaml, /- id: sess-init-1/);
    assert.doesNotMatch(yaml, /tacks:\s*\n\s*- t1/); // no tack bound by init alone
  });

  it("tack add records the session on the route", () => {
    const home = mkdtempSync(join(tmpdir(), "tack-add-sess-"));
    const e = { ...process.env, TACK_HOME: home, CLAUDE_CODE_SESSION_ID: "sess-add-1" };
    execFileSync("node", [cli, "init", "addroute"], { env: e });
    execFileSync("node", [cli, "add", "addroute", "Do the thing"], { env: e });
    const yaml = readFileSync(join(home, "routes", "addroute.yaml"), "utf-8");
    // Same session id across init + add dedups to a single sessions[] entry.
    assert.equal((yaml.match(/- id: sess-add-1/g) ?? []).length, 1);
  });

  it("is a no-op outside a Claude session", () => {
    const home = mkdtempSync(join(tmpdir(), "tack-create-nobind-"));
    const e: NodeJS.ProcessEnv = { ...process.env, TACK_HOME: home };
    delete e.CLAUDE_CODE_SESSION_ID;
    execFileSync("node", [cli, "init", "noroute"], { env: e });
    execFileSync("node", [cli, "add", "noroute", "Work"], { env: e });
    const yaml = readFileSync(join(home, "routes", "noroute.yaml"), "utf-8");
    assert.doesNotMatch(yaml, /sessions:/);
  });
});

// Tests share a single TACK_HOME and run concurrently, and find() scans every
// route — so each test uses a distinct URL to keep its collision set isolated.
describe("duplicate-url warning (issue #10)", () => {
  it("warns on stderr when a deliverable url is already on another tack", () => {
    const url = "https://github.com/owner/repo/pull/4201";
    runFail(["init", "dup-a"]);
    runFail(["add", "dup-a", "First"]);
    runFail(["deliverable", "dup-a", "t1", url]);
    runFail(["init", "dup-b"]);
    runFail(["add", "dup-b", "Second"]);
    const r = runCapture(["deliverable", "dup-b", "t1", url]);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /warning: url already on dup-a\/t1 \(deliverable\)/);
    assert.match(r.stderr, new RegExp(url.replace(/[/.]/g, "\\$&")));
  });

  it("warns when a link url is already on another tack", () => {
    const url = "https://github.com/owner/repo/pull/4202";
    runFail(["init", "dup-link-a"]);
    runFail(["add", "dup-link-a", "First"]);
    runFail(["link", "add", "dup-link-a", "t1", "issue", url]);
    runFail(["init", "dup-link-b"]);
    runFail(["add", "dup-link-b", "Second"]);
    const r = runCapture(["link", "add", "dup-link-b", "t1", "issue", url]);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /warning: url already on dup-link-a\/t1 \(link\)/);
  });

  it("warns from add --deliverable when the url is already attached", () => {
    const url = "https://github.com/owner/repo/pull/4203";
    runFail(["init", "dup-add-a"]);
    runFail(["add", "dup-add-a", "First", "--deliverable", url]);
    const r = runCapture(["add", "dup-add-a", "Second", "--deliverable", url]);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /warning: url already on dup-add-a\/t1 \(deliverable\)/);
  });

  it("does not warn on an idempotent re-attach to the same tack", () => {
    const url = "https://github.com/owner/repo/pull/4204";
    runFail(["init", "dup-self"]);
    runFail(["add", "dup-self", "Work"]);
    runFail(["deliverable", "dup-self", "t1", url]);
    // Re-attaching the same url to the same tack overwrites with --force; the
    // mutated tack is excluded from the collision scan, so no warning fires.
    const r = runCapture(["deliverable", "dup-self", "t1", url, "--force"]);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /warning: url already on/);
  });

  it("does not warn when the url is new", () => {
    const url = "https://github.com/owner/repo/pull/4205";
    runFail(["init", "dup-new"]);
    runFail(["add", "dup-new", "Work"]);
    const r = runCapture(["deliverable", "dup-new", "t1", url]);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stderr, /warning: url already on/);
  });

  it("names multiple existing tacks when the url is on several", () => {
    const url = "https://github.com/owner/repo/pull/4206";
    runFail(["init", "dup-multi-a"]);
    runFail(["add", "dup-multi-a", "First"]);
    runFail(["deliverable", "dup-multi-a", "t1", url]);
    runFail(["init", "dup-multi-b"]);
    runFail(["add", "dup-multi-b", "Second"]);
    runFail(["link", "add", "dup-multi-b", "t1", "ref", url]);
    runFail(["init", "dup-multi-c"]);
    runFail(["add", "dup-multi-c", "Third"]);
    const r = runCapture(["deliverable", "dup-multi-c", "t1", url]);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /dup-multi-a\/t1 \(deliverable\)/);
    assert.match(r.stderr, /dup-multi-b\/t1 \(link\)/);
  });
});

// Each test gets its own TACK_HOME(s) so export/import round-trips stay isolated.
describe("export / import backup (CL-49/CL-50)", () => {
  function home(): string {
    return mkdtempSync(join(tmpdir(), "tack-bk-"));
  }
  function run(h: string, args: string[]) {
    const r = spawnSync("node", [cli, ...args], {
      env: { ...process.env, TACK_HOME: h },
      encoding: "utf-8",
    });
    return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  it("export emits an uncompressed JSON archive to stdout by default", () => {
    const h = home();
    run(h, ["init", "alpha"]);
    run(h, ["add", "alpha", "First", "--deliverable", "https://github.com/o/r/pull/1"]);
    const r = run(h, ["export"]);
    assert.equal(r.status, 0);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.routes.length, 1);
    assert.equal(doc.routes[0].slug, "alpha");
  });

  it("export --out-file --compress writes a gzip document; status goes to stderr", () => {
    const h = home();
    const arc = join(h, "out.json.gz");
    run(h, ["init", "alpha"]);
    run(h, ["add", "alpha", "First"]);
    const r = run(h, ["export", "--out-file", arc, "--compress"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /→ .*out\.json\.gz/);
    const doc = JSON.parse(gunzipSync(readFileSync(arc)).toString("utf-8"));
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.routes[0].slug, "alpha");
  });

  it("import --replace restores routes into a fresh machine", () => {
    const a = home(), b = home();
    const arc = join(a, "out.json");
    run(a, ["init", "alpha"]);
    run(a, ["add", "alpha", "First"]);
    run(a, ["add", "alpha", "Second"]);
    run(a, ["export", "--out-file", arc]);
    const r = run(b, ["import", arc, "--replace"]);
    assert.equal(r.status, 0);
    const tree = run(b, ["tree", "alpha", "-d", "2"]).stdout;
    assert.match(tree, /t1: First/);
    assert.match(tree, /t2: Second/);
  });

  it("import accepts a gzip-compressed archive", () => {
    const a = home(), b = home();
    const arc = join(a, "out.json.gz");
    run(a, ["init", "alpha"]);
    run(a, ["add", "alpha", "First"]);
    run(a, ["export", "--out-file", arc, "--compress"]);
    const r = run(b, ["import", arc, "--replace"]);
    assert.equal(r.status, 0);
    assert.match(run(b, ["tree", "alpha", "-d", "2"]).stdout, /t1: First/);
  });

  it("merge dedups a tack already present by deliverable url", () => {
    const a = home(), b = home();
    const arc = join(a, "out.json");
    const url = "https://github.com/o/r/pull/7";
    run(a, ["init", "alpha"]);
    run(a, ["add", "alpha", "Ship it", "--deliverable", url]);
    run(a, ["export", "--out-file", arc]);
    run(b, ["init", "alpha"]);
    run(b, ["add", "alpha", "Ship it", "--deliverable", url]);
    const r = run(b, ["import", arc]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /0 tacks added/);
  });

  it("merge appends a new tack with a reported id reassignment", () => {
    const a = home(), b = home();
    const arc = join(a, "out.json");
    run(a, ["init", "alpha"]);
    run(a, ["add", "alpha", "Extra work"]);
    run(a, ["export", "--out-file", arc]);
    run(b, ["init", "alpha"]);
    run(b, ["add", "alpha", "Local one"]);
    run(b, ["add", "alpha", "Local two"]);
    const r = run(b, ["import", arc]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /1 tacks added/);
    assert.match(r.stdout, /t1 → t3\s+Extra work/);
  });

  it("merge remaps depends_on edges among appended tacks", () => {
    const a = home(), b = home();
    const arc = join(a, "out.json");
    run(a, ["init", "alpha"]);
    run(a, ["add", "alpha", "Base"]);
    run(a, ["add", "alpha", "Dependent", "--depends-on", "t1"]);
    run(a, ["export", "--out-file", arc]);
    run(b, ["init", "alpha"]);
    run(b, ["add", "alpha", "Local"]); // occupies t1 in b
    run(b, ["import", arc]);
    // a's t1 → b t2, a's t2 → b t3; the edge must now point at t2, not t1
    const dep = run(b, ["tree", "alpha/t3/depends_on"]).stdout;
    assert.match(dep, /t2/);
    assert.doesNotMatch(dep, /t1/);
  });

  it("--dry-run reports changes but writes nothing", () => {
    const a = home(), b = home();
    const arc = join(a, "out.json");
    run(a, ["init", "alpha"]);
    run(a, ["add", "alpha", "New tack"]);
    run(a, ["export", "--out-file", arc]);
    run(b, ["init", "alpha"]);
    run(b, ["add", "alpha", "Local"]);
    const r = run(b, ["import", arc, "--dry-run"]);
    assert.match(r.stdout, /\[dry-run\]/);
    assert.match(r.stdout, /1 tacks added/);
    const tree = run(b, ["tree", "alpha", "-d", "2"]).stdout;
    assert.doesNotMatch(tree, /New tack/);
  });

  it("refuses an archive whose schemaVersion is newer than supported", () => {
    const h = home();
    const arc = join(h, "future.json.gz");
    writeFileSync(arc, gzipSync(Buffer.from(JSON.stringify({ schemaVersion: 999, routes: [] }))));
    const r = run(h, ["import", arc]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /newer than this tack supports/);
  });
});
