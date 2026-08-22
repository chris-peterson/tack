import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
const cli = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
const env = { ...process.env, TACK_HOME: mkdtempSync(join(tmpdir(), "tack-cli-test-")) };
// Strip the ambient session id so the suite behaves the same inside a Claude
// session as outside it — otherwise `init`/`add`/`start` would record the
// runner's own session and inflate sessions[] in tests that never set it.
delete env.CLAUDE_CODE_SESSION_ID;
function runFail(args) {
    try {
        const stdout = execFileSync("node", [cli, ...args], { env, encoding: "utf-8" });
        return { status: 0, stdout, stderr: "" };
    }
    catch (e) {
        const err = e;
        return { status: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
}
// Captures stderr regardless of exit code — runFail discards it on success,
// which hides warnings emitted by commands that still exit 0.
function runCapture(args, input) {
    const r = spawnSync("node", [cli, ...args], { env, encoding: "utf-8", input });
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
describe("tack add --link (issue #15)", () => {
    it("creates a tack with a link in one call", () => {
        runFail(["init", "add-link-one"]);
        const r = runFail([
            "add", "add-link-one", "Work",
            "--link", "issue,https://github.com/o/r/issues/1",
        ]);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /link: issue — https:\/\/github\.com\/o\/r\/issues\/1/);
    });
    it("accumulates multiple --link flags and combines with --deliverable", () => {
        runFail(["init", "add-link-multi"]);
        const r = runFail([
            "add", "add-link-multi", "Work",
            "--deliverable", "https://github.com/o/r/pull/2",
            "--link", "issue,https://github.com/o/r/issues/1",
            "--link", "design,https://docs.example.com/x",
        ]);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /deliverable: r#2/);
        assert.match(r.stdout, /link: issue/);
        assert.match(r.stdout, /link: design/);
    });
    it("rejects a --link value without a comma", () => {
        runFail(["init", "add-link-bad"]);
        const r = runFail(["add", "add-link-bad", "Work", "--link", "nocomma"]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /expected "label,url"/);
    });
});
describe("tack deliverable rm (issue #24)", () => {
    it("clears the deliverable", () => {
        runFail(["init", "dlv-rm-cli"]);
        runFail(["add", "dlv-rm-cli", "Work", "--deliverable", "https://github.com/o/r/pull/1"]);
        const r = runFail(["deliverable", "rm", "dlv-rm-cli", "t1"]);
        assert.equal(r.status, 0);
        assert.doesNotMatch(r.stdout, /deliverable:/);
    });
    it("demotes the deliverable into links with --to-link", () => {
        runFail(["init", "dlv-rm-cli-link"]);
        runFail(["add", "dlv-rm-cli-link", "Work", "--deliverable", "https://github.com/o/r/pull/1"]);
        const r = runFail(["deliverable", "rm", "dlv-rm-cli-link", "t1", "--to-link"]);
        assert.equal(r.status, 0);
        assert.doesNotMatch(r.stdout, /deliverable:/);
        assert.match(r.stdout, /link: r#1 — https:\/\/github\.com\/o\/r\/pull\/1/);
    });
    it("errors with missing args", () => {
        const r = runFail(["deliverable", "rm", "some-slug"]);
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
describe("tack title (CLI-53)", () => {
    it("sets a title on an existing route", () => {
        runFail(["init", "ttl-set"]);
        const r = runFail(["title", "ttl-set", "Q3 auth rewrite"]);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /title: Q3 auth rewrite/);
        assert.match(r.stdout, /# ttl-set/);
    });
    it("prints the current title when no text argument is given", () => {
        runFail(["init", "ttl-show"]);
        runFail(["title", "ttl-show", "Payments cutover"]);
        const r = runFail(["title", "ttl-show"]);
        assert.equal(r.status, 0);
        assert.equal(r.stdout.trim(), "Payments cutover");
    });
    it("clears the title with --clear", () => {
        runFail(["init", "ttl-clear"]);
        runFail(["title", "ttl-clear", "temporary"]);
        const r = runFail(["title", "ttl-clear", "--clear"]);
        assert.equal(r.status, 0);
        assert.doesNotMatch(r.stdout, /title: temporary/);
    });
    it("exits non-zero when reporting an untitled route", () => {
        runFail(["init", "ttl-none"]);
        const r = runFail(["title", "ttl-none"]);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /no title set on ttl-none/);
    });
    it("leaves the slug as the listing key, with the title alongside", () => {
        runFail(["init", "ttl-listed"]);
        runFail(["title", "ttl-listed", "Q3 auth rewrite"]);
        const r = runFail(["list"]);
        assert.match(r.stdout, /ttl-listed {2}\(0 open \/ 0 total\) {2}Q3 auth rewrite/);
    });
    it("carries the title in list --json", () => {
        runFail(["init", "ttl-json"]);
        runFail(["title", "ttl-json", "Q3 auth rewrite"]);
        const r = runFail(["list", "--json"]);
        const entry = JSON.parse(r.stdout).find((e) => e.slug === "ttl-json");
        assert.equal(entry.title, "Q3 auth rewrite");
    });
});
describe("tack describe (CLI-54)", () => {
    const md = "# Goal\n\nShip the rewrite.\n\n- one\n- two";
    it("sets a description from an inline argument", () => {
        runFail(["init", "dsc-inline"]);
        const r = runFail(["describe", "dsc-inline", "Consolidate the auth paths."]);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /\):\n {4}Consolidate the auth paths\.\n {2}end description/);
    });
    it("reads a markdown body from --file and prints it back verbatim", () => {
        const path = join(mkdtempSync(join(tmpdir(), "tack-desc-")), "body.md");
        writeFileSync(path, `${md}\n`);
        runFail(["init", "dsc-file"]);
        runFail(["describe", "dsc-file", "--file", path]);
        const r = runFail(["describe", "dsc-file"]);
        assert.equal(r.status, 0);
        assert.equal(r.stdout, `${md}\n`);
    });
    it("reads a markdown body from stdin with --file -", () => {
        runFail(["init", "dsc-stdin"]);
        const set = runCapture(["describe", "dsc-stdin", "--file", "-"], `${md}\n`);
        assert.equal(set.status, 0);
        const r = runFail(["describe", "dsc-stdin"]);
        assert.equal(r.stdout, `${md}\n`);
    });
    it("stores the same value whether the body arrived inline or by pipe (CLI-54a)", () => {
        runFail(["init", "dsc-inline-eq"]);
        runFail(["describe", "dsc-inline-eq", "Ship the rewrite."]);
        runFail(["init", "dsc-piped-eq"]);
        runCapture(["describe", "dsc-piped-eq", "--file", "-"], "Ship the rewrite.\n");
        assert.equal(runFail(["describe", "dsc-inline-eq"]).stdout, runFail(["describe", "dsc-piped-eq"]).stdout);
    });
    it("fails when given both inline text and --file", () => {
        runFail(["init", "dsc-both"]);
        const r = runFail(["describe", "dsc-both", "inline", "--file", "-"]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /tack describe: pass either <text> or --file <path>, not both\./);
    });
    it("fails on an empty piped body rather than storing one", () => {
        runFail(["init", "dsc-empty-pipe"]);
        const r = runCapture(["describe", "dsc-empty-pipe", "--file", "-"], "\n");
        assert.equal(r.status, 1);
        assert.match(r.stderr, /tack describe: stdin is empty; use --clear to remove the description\./);
        assert.equal(runFail(["describe", "dsc-empty-pipe"]).status, 1);
    });
    it("fails on an empty --file body and names the path", () => {
        const path = join(mkdtempSync(join(tmpdir(), "tack-desc-")), "empty.md");
        writeFileSync(path, "");
        runFail(["init", "dsc-empty-file"]);
        const r = runFail(["describe", "dsc-empty-file", "--file", path]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /is empty; use --clear to remove the description\./);
        assert.ok(r.stderr.includes(path));
    });
    it("clears the description with --clear", () => {
        runFail(["init", "dsc-clear"]);
        runFail(["describe", "dsc-clear", "temporary"]);
        const r = runFail(["describe", "dsc-clear", "--clear"]);
        assert.equal(r.status, 0);
        assert.doesNotMatch(r.stdout, /temporary/);
    });
    it("exits non-zero when reporting a route with no description", () => {
        runFail(["init", "dsc-none"]);
        const r = runFail(["describe", "dsc-none"]);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /no description set on dsc-none/);
    });
    it("includes both fields in status --json", () => {
        runFail(["init", "dsc-json"]);
        runFail(["title", "dsc-json", "Q3 auth rewrite"]);
        runFail(["describe", "dsc-json", md]);
        const r = runFail(["status", "dsc-json", "--json"]);
        const parsed = JSON.parse(r.stdout);
        assert.equal(parsed.title, "Q3 auth rewrite");
        assert.equal(parsed.description, md);
    });
});
describe("tack repo (CLI-42..46)", () => {
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
    it("captures the repo from add --deliverable (REPO-06)", () => {
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
    it("list --help prints usage instead of silently listing routes", () => {
        const r = runFail(["list", "--help"]);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /Usage:/);
        // `list` parses its flags by hand, so without the pre-dispatch check it
        // would ignore --help and print the route list instead.
        assert.doesNotMatch(r.stdout, /open \/ /);
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
        const e = { ...process.env, TACK_HOME: home };
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
        const e = { ...process.env, TACK_HOME: home };
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
describe("export / import backup (CLI-49/CLI-50)", () => {
    function home() {
        return mkdtempSync(join(tmpdir(), "tack-bk-"));
    }
    function run(h, args) {
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
describe("tack find --path (CLI-23a)", () => {
    function gitRepo(origin) {
        const dir = mkdtempSync(join(tmpdir(), "tack-find-path-"));
        execFileSync("git", ["-C", dir, "init", "-q"]);
        execFileSync("git", ["-C", dir, "remote", "add", "origin", origin]);
        return dir;
    }
    it("finds routes whose deliverable lives in the checkout's repo", () => {
        runFail(["init", "fp-match"]);
        runFail(["add", "fp-match", "Work", "--deliverable", "https://github.com/acme/pathtest/pull/1"]);
        const dir = gitRepo("git@github.com:acme/pathtest.git");
        const r = runFail(["find", "--path", dir, "--json"]);
        assert.equal(r.status, 0);
        const matches = JSON.parse(r.stdout);
        assert.equal(matches.length, 1);
        assert.equal(matches[0].slug, "fp-match");
        assert.equal(matches[0].url, "https://github.com/acme/pathtest/pull/1");
    });
    it("emits an empty array for a directory with no git origin", () => {
        const dir = mkdtempSync(join(tmpdir(), "tack-find-nogit-"));
        const r = runFail(["find", "--path", dir, "--json"]);
        assert.equal(r.status, 0);
        assert.deepEqual(JSON.parse(r.stdout), []);
    });
    it("reports no match (exit 0) when the repo is recognized but untracked", () => {
        const dir = gitRepo("git@github.com:acme/untracked.git");
        const r = runFail(["find", "--path", dir]);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /No tacks reference repo github\.com\/acme\/untracked/);
    });
});
describe("tack find --url (CLI-23) and selector requirement (CLI-23b)", () => {
    it("finds tacks referencing a URL via --url", () => {
        runFail(["init", "furl-match"]);
        runFail(["add", "furl-match", "Work", "--deliverable", "https://github.com/acme/urltest/pull/7"]);
        const r = runFail(["find", "--url", "https://github.com/acme/urltest/pull/7", "--json"]);
        assert.equal(r.status, 0);
        const matches = JSON.parse(r.stdout);
        assert.equal(matches.length, 1);
        assert.equal(matches[0].slug, "furl-match");
    });
    it("fails when neither --url nor --path is given", () => {
        const r = runFail(["find"]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /exactly one of --url .* or --path/);
    });
    it("fails when both --url and --path are given", () => {
        const r = runFail(["find", "--url", "https://x/y/pull/1", "--path"]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /exactly one of --url .* or --path/);
    });
    it("fails when --url has no value", () => {
        const r = runFail(["find", "--url"]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /--url requires a url/);
    });
});
// The usage text is the CLI's public grammar; the snapshot makes a grammar
// change a diff. Regenerate with `just usage-snapshot`.
describe("the CLI grammar matches its checked-in snapshot", () => {
    const snapshotPath = join(dirname(fileURLToPath(import.meta.url)), "..", "spec", "cli-usage.txt");
    it("--help output is unchanged", () => {
        const lines = readFileSync(snapshotPath, "utf-8").split("\n");
        while (lines[0]?.startsWith("#"))
            lines.shift();
        const r = runFail(["--help"]);
        assert.equal(r.status, 0);
        assert.equal(r.stdout, lines.join("\n"), "CLI usage drifted from spec/cli-usage.txt — run `just usage-snapshot` if the change is intended");
    });
});
describe("tack add --link splits label from url (issue #28)", () => {
    it("keeps a comma inside the label", () => {
        runFail(["init", "link-comma"]);
        const label = "Refine session replay (N+1 example, terminal frame)";
        const r = runFail([
            "add", "link-comma", "x",
            "--link", `${label},https://github.com/chris-peterson/tack/commit/54d175d`,
        ]);
        assert.equal(r.status, 0);
        const json = JSON.parse(runFail(["list", "--json"]).stdout);
        const link = json.find((x) => x.slug === "link-comma")?.tacks[0].links?.[0];
        assert.equal(link?.label, label);
        assert.equal(link?.url, "https://github.com/chris-peterson/tack/commit/54d175d");
    });
    it("keeps a comma inside the url", () => {
        runFail(["init", "link-url-comma"]);
        const url = "https://example.com/issues?ids=1,2,3";
        const r = runFail(["add", "link-url-comma", "x", "--link", `report,${url}`]);
        assert.equal(r.status, 0);
        const json = JSON.parse(runFail(["list", "--json"]).stdout);
        const link = json.find((x) => x.slug === "link-url-comma")?.tacks[0].links?.[0];
        assert.equal(link?.label, "report");
        assert.equal(link?.url, url);
    });
    it("keeps commas on both sides at once", () => {
        runFail(["init", "link-both"]);
        const label = "a, b, c";
        const url = "https://example.com/q?ids=4,5";
        assert.equal(runFail(["add", "link-both", "x", "--link", `${label},${url}`]).status, 0);
        const json = JSON.parse(runFail(["list", "--json"]).stdout);
        const link = json.find((x) => x.slug === "link-both")?.tacks[0].links?.[0];
        assert.equal(link?.label, label);
        assert.equal(link?.url, url);
    });
    it("names the label/url split when no suffix is a url", () => {
        runFail(["init", "link-bad"]);
        const r = runFail(["add", "link-bad", "x", "--link", "label,not-a-url"]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /expected "label,url" where url is absolute/);
    });
    it("does not lose the other links on the same invocation", () => {
        runFail(["init", "link-atomic"]);
        const r = runFail([
            "add", "link-atomic", "x",
            "--link", "good,https://example.com/a",
            "--link", "with, comma,https://example.com/b",
        ]);
        assert.equal(r.status, 0);
        const json = JSON.parse(runFail(["list", "--json"]).stdout);
        const links = json.find((x) => x.slug === "link-atomic")?.tacks[0].links ?? [];
        assert.deepEqual(links.map((l) => l.url), [
            "https://example.com/a",
            "https://example.com/b",
        ]);
    });
});
describe("top-level error handler", () => {
    it("reports a missing route as a message, not a stack trace", () => {
        const r = runCapture(["status", "no-such-route"]);
        assert.equal(r.status, 1);
        assert.equal(r.stdout, "");
        assert.match(r.stderr, /^tack: Route not found: no-such-route$/m);
        assert.doesNotMatch(r.stderr, /\n\s+at /);
    });
    it("reports an unknown flag and points at --help", () => {
        const r = runCapture(["done", "some-route", "t1", "--nope"]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /^tack: Unknown option '--nope'/m);
        assert.match(r.stderr, /Run `tack --help` for usage\./);
        assert.doesNotMatch(r.stderr, /\n\s+at /);
    });
    it("restores the stack under TACK_DEBUG", () => {
        const r = spawnSync("node", [cli, "status", "no-such-route"], {
            env: { ...env, TACK_DEBUG: "1" },
            encoding: "utf-8",
        });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /Error: Route not found: no-such-route/);
        assert.match(r.stderr, /\n\s+at /);
    });
});
describe("tack rm refuses without --force", () => {
    it("puts the refusal on stderr and leaves stdout empty", () => {
        runFail(["init", "rm-refuse"]);
        const r = runCapture(["rm", "rm-refuse"]);
        assert.equal(r.status, 1);
        assert.equal(r.stdout, "");
        assert.match(r.stderr, /Delete route rm-refuse\? Pass --force to confirm\./);
    });
    it("leaves the route in place", () => {
        runFail(["init", "rm-intact"]);
        runCapture(["rm", "rm-intact"]);
        assert.equal(runFail(["status", "rm-intact"]).status, 0);
    });
});
// Issue #49: one route file that fails validation used to abort every command
// that enumerates the store, so a single bad file out of 77 cost access to all
// 77. Each test gets its own store — an invalid file in the shared one would
// break every listing test in this suite.
describe("an unreadable route file does not take the listing down with it", () => {
    // A store holding one good route and one whose `after` note is over the
    // limit, written past the CLI the way an agent editing the YAML directly
    // does — `tack after` itself refuses the same text.
    function storeWithOneBadFile() {
        const home = mkdtempSync(join(tmpdir(), "tack-invalid-"));
        const e = { ...process.env, TACK_HOME: home };
        delete e.CLAUDE_CODE_SESSION_ID;
        execFileSync("node", [cli, "init", "good-one"], { env: e });
        execFileSync("node", [cli, "init", "bad-one"], { env: e });
        execFileSync("node", [cli, "add", "bad-one", "a tack"], { env: e });
        const path = join(home, "routes", "bad-one.yaml");
        writeFileSync(path, readFileSync(path, "utf-8").replace(/\n$/, "") +
            `\n    after:\n      - id: a1\n        text: ${"x".repeat(1200)}\n        done: false\n`);
        return e;
    }
    function run(e, args) {
        const r = spawnSync("node", [cli, ...args], { env: e, encoding: "utf-8" });
        return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    }
    for (const args of [["list"], ["recent"], ["tree"], ["status"]]) {
        it(`${args.join(" ")} still renders the routes it could read`, () => {
            const r = run(storeWithOneBadFile(), args);
            assert.match(r.stdout, /good-one/);
        });
        it(`${args.join(" ")} names the file it left out, on stderr`, () => {
            const r = run(storeWithOneBadFile(), args);
            assert.match(r.stderr, /bad-one\.yaml/);
            assert.match(r.stderr, /must NOT have more than 1000 characters/);
        });
        // Availability is restored without making the gap silent: a script reading
        // the output still learns the answer is incomplete.
        it(`${args.join(" ")} still exits non-zero`, () => {
            assert.notEqual(run(storeWithOneBadFile(), args).status, 0);
        });
    }
    it("list --json emits a parseable array of the readable routes on stdout", () => {
        const r = run(storeWithOneBadFile(), ["list", "--json"]);
        const parsed = JSON.parse(r.stdout);
        assert.deepEqual(parsed.map((x) => x.slug), ["good-one"]);
    });
    // An export that quietly omits a route is a lossy backup wearing a
    // successful exit; completeness outranks availability here.
    it("export still refuses rather than writing an incomplete archive", () => {
        const r = run(storeWithOneBadFile(), ["export"]);
        assert.equal(r.status, 1);
        assert.equal(r.stdout, "");
        assert.match(r.stderr, /bad-one\.yaml/);
    });
});
describe("tack doctor", () => {
    function storeWith(files) {
        const home = mkdtempSync(join(tmpdir(), "tack-doctor-"));
        const e = { ...process.env, TACK_HOME: home };
        delete e.CLAUDE_CODE_SESSION_ID;
        execFileSync("node", [cli, "init", "healthy"], { env: e });
        for (const [name, body] of Object.entries(files)) {
            writeFileSync(join(home, "routes", name), body);
        }
        return e;
    }
    function run(e, args) {
        const r = spawnSync("node", [cli, ...args], { env: e, encoding: "utf-8" });
        return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    }
    const routeFile = (slug, note) => `id: 6e6f2f4a-0000-4000-8000-000000000001\nslug: ${slug}\n` +
        `created_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n` +
        `tacks:\n  - id: t1\n    summary: a tack\n    status: pending\n` +
        `    after:\n      - id: a1\n        text: ${note}\n        done: false\n`;
    const overLong = (slug) => routeFile(slug, "x".repeat(1200));
    it("exits zero and says so when every route file reads", () => {
        const r = run(storeWith({}), ["doctor"]);
        assert.equal(r.status, 0);
        assert.match(r.stdout, /1 route file/);
    });
    it("reports the route, the path, and the rule for each violation", () => {
        const r = run(storeWith({ "sick.yaml": overLong("sick") }), ["doctor"]);
        assert.match(r.stdout, /sick\.yaml/);
        assert.match(r.stdout, /\/tacks\/0\/after\/0\/text/);
        assert.match(r.stdout, /must NOT have more than 1000 characters/);
    });
    // The user has to edit the file by hand, so the report has to say which file
    // and what to change — a rule name alone leaves them reading the schema.
    it("names the file to edit and how to re-check it", () => {
        const r = run(storeWith({ "sick.yaml": overLong("sick") }), ["doctor"]);
        assert.match(r.stdout, /routes\/sick\.yaml/);
        assert.match(r.stdout, /tack doctor/);
    });
    it("exits non-zero when any violation exists", () => {
        assert.equal(run(storeWith({ "sick.yaml": overLong("sick") }), ["doctor"]).status, 1);
    });
    // load() refuses a file whose internal slug disagrees with its name, and the
    // repair is a rename rather than a field edit — doctor has to say which.
    it("reports a filename that disagrees with the slug inside", () => {
        const file = routeFile("declared-elsewhere", "a note of ordinary length");
        const r = run(storeWith({ "misnamed.yaml": file }), ["doctor"]);
        assert.match(r.stdout, /misnamed\.yaml/);
        assert.match(r.stdout, /declared-elsewhere/);
    });
    it("reports a file that is not parseable YAML at all", () => {
        const r = run(storeWith({ "broken.yaml": "tacks: [unclosed\n" }), ["doctor"]);
        assert.equal(r.status, 1);
        assert.match(r.stdout, /broken\.yaml/);
    });
    it("emits the same report as JSON", () => {
        const r = run(storeWith({ "sick.yaml": overLong("sick") }), ["doctor", "--json"]);
        const parsed = JSON.parse(r.stdout);
        assert.equal(parsed.invalid[0].slug, "sick");
        assert.match(parsed.invalid[0].errors[0], /must NOT have more than 1000 characters/);
    });
});
describe("note text is bounded at the command boundary (issue #49)", () => {
    it("accepts a note at the raised limit that the old one refused", () => {
        runFail(["init", "note-limit"]);
        runFail(["add", "note-limit", "a tack"]);
        assert.equal(runFail(["after", "note-limit", "t1", "x".repeat(993)]).status, 0);
    });
    // Not the raw ajv path (`/tacks/0/after/0/text`) the write path used to
    // surface: the caller supplied a note, so the message names the note.
    it("names the field and the limit rather than a schema path", () => {
        runFail(["init", "note-limit-over"]);
        runFail(["add", "note-limit-over", "a tack"]);
        const r = runCapture(["after", "note-limit-over", "t1", "x".repeat(1001)]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /note text/);
        assert.match(r.stderr, /1000/);
        assert.doesNotMatch(r.stderr, /\/tacks\/\d+\//);
    });
    it("bounds a before note the same way", () => {
        runFail(["init", "note-limit-before"]);
        runFail(["add", "note-limit-before", "a tack"]);
        const r = runCapture(["before", "note-limit-before", "t1", "x".repeat(1001)]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /note text/);
    });
    it("bounds a tack summary, naming that field instead", () => {
        runFail(["init", "summary-limit"]);
        const r = runCapture(["add", "summary-limit", "x".repeat(501)]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /summary/);
        assert.match(r.stderr, /500/);
    });
});
