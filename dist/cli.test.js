import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
const cli = join(dirname(fileURLToPath(import.meta.url)), "cli.js");
const env = { ...process.env, TACK_HOME: mkdtempSync(join(tmpdir(), "tack-cli-test-")) };
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
