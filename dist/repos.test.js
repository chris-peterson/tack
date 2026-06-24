import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
let repos;
const tmp = mkdtempSync(join(tmpdir(), "tack-repos-test-"));
process.env.TACK_HOME = tmp;
const reposFile = join(tmp, "repos.yaml");
before(async () => {
    repos = await import("./repos.js");
});
after(() => {
    rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
    rmSync(reposFile, { force: true });
});
describe("normalizeGitRemote (RP-02)", () => {
    it("strips scheme and .git from an HTTPS remote", () => {
        assert.equal(repos.normalizeGitRemote("https://github.com/chris-peterson/anchor.git"), "github.com/chris-peterson/anchor");
    });
    it("normalizes an scp-style SSH remote to the same key", () => {
        assert.equal(repos.normalizeGitRemote("git@github.com:chris-peterson/anchor.git"), "github.com/chris-peterson/anchor");
    });
    it("normalizes an ssh:// remote with userinfo", () => {
        assert.equal(repos.normalizeGitRemote("ssh://git@github.com/chris-peterson/anchor.git"), "github.com/chris-peterson/anchor");
    });
    it("collapses HTTPS and SSH forms to one identity", () => {
        assert.equal(repos.normalizeGitRemote("https://github.com/chris-peterson/anchor"), repos.normalizeGitRemote("git@github.com:chris-peterson/anchor.git"));
    });
    it("handles a self-hosted GitLab remote with nested groups", () => {
        assert.equal(repos.normalizeGitRemote("https://gitlab.example.com/group/sub/repo.git"), "gitlab.example.com/group/sub/repo");
    });
    it("returns null for a non-remote string", () => {
        assert.equal(repos.normalizeGitRemote("not-a-remote"), null);
    });
});
describe("repoKeyFromForgeUrl (RP-06)", () => {
    it("extracts host/org/repo from a GitHub PR URL", () => {
        assert.equal(repos.repoKeyFromForgeUrl("https://github.com/chris-peterson/anchor/pull/42"), "github.com/chris-peterson/anchor");
    });
    it("extracts from a GitHub issue and commit URL", () => {
        assert.equal(repos.repoKeyFromForgeUrl("https://github.com/org/repo/issues/3"), "github.com/org/repo");
        assert.equal(repos.repoKeyFromForgeUrl("https://github.com/org/repo/commit/abc1234"), "github.com/org/repo");
    });
    it("extracts the repo path before /-/ for a GitLab MR URL", () => {
        assert.equal(repos.repoKeyFromForgeUrl("https://gitlab.example.com/group/sub/repo/-/merge_requests/9"), "gitlab.example.com/group/sub/repo");
    });
    it("returns null for a plain (non-forge) link", () => {
        assert.equal(repos.repoKeyFromForgeUrl("https://docs.example.com/auth-design"), null);
    });
});
describe("recordUrl + matchByName (RP-06, CL-42)", () => {
    it("captures a repo from a deliverable URL and matches by partial name", () => {
        repos.recordUrl("https://github.com/chris-peterson/anchor/pull/5");
        const matches = repos.matchByName("ancho");
        assert.equal(matches.length, 1);
        assert.equal(matches[0].url, "https://github.com/chris-peterson/anchor");
        assert.deepEqual(matches[0].names, ["anchor"]);
    });
    it("is idempotent — recording the same repo twice keeps one name", () => {
        repos.recordUrl("https://github.com/org/repo/pull/1");
        repos.recordUrl("https://github.com/org/repo/issues/2");
        const matches = repos.matchByName("repo");
        assert.equal(matches.length, 1);
        assert.deepEqual(matches[0].names, ["repo"]);
    });
    it("ignores a non-forge URL", () => {
        repos.recordUrl("https://docs.example.com/design");
        assert.equal(repos.listRepos().length, 0);
    });
    it("matches case-insensitively", () => {
        repos.recordUrl("https://github.com/org/MyRepo/pull/1");
        assert.equal(repos.matchByName("myrepo").length, 1);
    });
});
describe("recordCwd (RP-07)", () => {
    it("captures the origin remote and records the cwd as a local", () => {
        const repoDir = mkdtempSync(join(tmpdir(), "tack-gitrepo-"));
        execFileSync("git", ["-C", repoDir, "init", "-q"]);
        execFileSync("git", [
            "-C", repoDir, "remote", "add", "origin",
            "git@github.com:chris-peterson/anchor.git",
        ]);
        repos.recordCwd(repoDir);
        const matches = repos.matchByName("anchor");
        assert.equal(matches.length, 1);
        assert.equal(matches[0].key, "github.com/chris-peterson/anchor");
        assert.ok(matches[0].locals.includes(repoDir));
        rmSync(repoDir, { recursive: true, force: true });
    });
    it("records nothing and does not throw outside a git repo", () => {
        const bare = mkdtempSync(join(tmpdir(), "tack-nogit-"));
        assert.doesNotThrow(() => repos.recordCwd(bare));
        assert.equal(repos.listRepos().length, 0);
        rmSync(bare, { recursive: true, force: true });
    });
});
describe("addAlias (CL-44)", () => {
    it("adds a custom name that lookup then matches", () => {
        repos.recordUrl("https://github.com/chris-peterson/anchor/pull/1");
        repos.addAlias("anchor", "anch");
        const matches = repos.matchByName("anch");
        assert.equal(matches.length, 1);
        assert.ok(matches[0].names.includes("anch"));
    });
    it("fails when the match is ambiguous", () => {
        repos.recordUrl("https://github.com/org/alpha/pull/1");
        repos.recordUrl("https://github.com/org/alphabet/pull/1");
        assert.throws(() => repos.addAlias("alpha", "x"), /matches 2 repos/);
    });
});
describe("pruneLocals (CL-45)", () => {
    it("drops a stale local but retains a URL-only repo with no locals", () => {
        // URL-only repo (no locals) — must survive prune.
        repos.recordUrl("https://github.com/org/url-only/pull/1");
        // Repo with a local that we then delete, simulating a removed worktree.
        const repoDir = mkdtempSync(join(tmpdir(), "tack-gitrepo-"));
        execFileSync("git", ["-C", repoDir, "init", "-q"]);
        execFileSync("git", [
            "-C", repoDir, "remote", "add", "origin",
            "git@github.com:org/withlocal.git",
        ]);
        repos.recordCwd(repoDir);
        rmSync(repoDir, { recursive: true, force: true });
        const removed = repos.pruneLocals();
        assert.equal(removed.length, 1);
        assert.equal(removed[0].path, repoDir);
        // Both repos still present; the URL-only entry is untouched.
        const keys = repos.listRepos().map((r) => r.key).sort();
        assert.deepEqual(keys, ["github.com/org/url-only", "github.com/org/withlocal"]);
    });
});
describe("rebuildFrom (CL-47)", () => {
    it("backfills names from forge URLs and preserves existing aliases", () => {
        repos.recordUrl("https://github.com/chris-peterson/anchor/pull/1");
        repos.addAlias("anchor", "anch");
        const result = repos.rebuildFrom({
            urls: [
                "https://github.com/chris-peterson/anchor/pull/2", // existing repo
                "https://github.com/chris-peterson/moor/issues/3", // new repo
                "https://docs.example.com/not-a-repo", // ignored
            ],
            cwds: [],
        });
        assert.equal(result.urlsMatched, 2);
        assert.equal(result.repoCount, 2);
        // The custom alias survives the rebuild.
        assert.ok(repos.matchByName("anch").length === 1);
        assert.equal(repos.matchByName("moor").length, 1);
    });
});
describe("removeRepo (CL-46)", () => {
    it("removes the matched entry", () => {
        repos.recordUrl("https://github.com/org/repo/pull/1");
        repos.removeRepo("repo");
        assert.equal(repos.listRepos().length, 0);
    });
    it("fails when the match is ambiguous", () => {
        repos.recordUrl("https://github.com/org/alpha/pull/1");
        repos.recordUrl("https://github.com/org/alphabet/pull/1");
        assert.throws(() => repos.removeRepo("alpha"), /matches 2 repos/);
    });
});
