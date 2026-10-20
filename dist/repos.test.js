import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
describe("normalizeGitRemote (REPO-02)", () => {
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
describe("repoKeyFromForgeUrl (REPO-06)", () => {
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
describe("recordUrl + matchByName (REPO-06, CLI-42)", () => {
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
describe("recordCwd (REPO-07)", () => {
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
describe("pruneLocals (CLI-45)", () => {
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
describe("rebuildFrom (CLI-47)", () => {
    it("backfills names from forge URLs", () => {
        repos.recordUrl("https://github.com/chris-peterson/anchor/pull/1");
        const result = repos.rebuildFrom({
            urls: [
                "https://github.com/chris-peterson/anchor/pull/2", // existing repo
                "https://github.com/chris-peterson/moor/issues/3", // new repo
                "https://docs.example.com/not-a-repo", // ignored
            ],
        });
        assert.equal(result.urlsMatched, 2);
        assert.equal(result.repoCount, 2);
        assert.equal(repos.matchByName("moor").length, 1);
    });
    it("records a checkout found under the source root whose origin is the repo", () => {
        const srcRoot = join(tmp, "src");
        const checkout = join(srcRoot, "github", "chris-peterson", "anchor");
        const impostor = join(srcRoot, "gitlab", "chris-peterson", "moor");
        for (const [dir, origin] of [
            [checkout, "git@github.com:chris-peterson/anchor.git"],
            [impostor, "https://gitlab.com/someone-else/moor.git"],
        ]) {
            mkdirSync(dir, { recursive: true });
            execFileSync("git", ["init", "-q", dir]);
            execFileSync("git", ["-C", dir, "remote", "add", "origin", origin]);
        }
        const result = repos.rebuildFrom({
            urls: [
                "https://github.com/chris-peterson/anchor/pull/2",
                "https://github.com/chris-peterson/moor/issues/3",
            ],
            srcRoot,
        });
        assert.equal(result.localsAdded, 1);
        assert.deepEqual(repos.matchByName("anchor")[0].locals, [checkout]);
        assert.deepEqual(repos.matchByName("moor")[0].locals, []);
    });
});
describe("removeRepo (CLI-46)", () => {
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
describe("repoKeyFromForgeUrl and the GitLab work-item paths (issue #33)", () => {
    it("derives the same repo key from work_items as from issues", () => {
        assert.equal(repos.repoKeyFromForgeUrl("https://gitlab.example.com/group/repo/-/work_items/9"), repos.repoKeyFromForgeUrl("https://gitlab.example.com/group/repo/-/issues/9"));
    });
    // Both can be group-scoped, where the captured segment is a group rather than
    // a repo; recording that would put a non-repo entry in the database.
    it("derives no repo key from a group epic", () => {
        assert.equal(repos.repoKeyFromForgeUrl("https://gitlab.example.com/groups/mygroup/-/epics/5"), null);
    });
    it("derives no repo key from a milestone", () => {
        assert.equal(repos.repoKeyFromForgeUrl("https://gitlab.example.com/group/repo/-/milestones/3"), null);
    });
});
describe("uniqueLabels (CLI-60)", () => {
    const labels = (keys) => Object.fromEntries(repos.uniqueLabels(keys));
    it("labels a repo by its name alone when no other repo shares it", () => {
        assert.deepEqual(labels(["github.com/chris-peterson/tack", "gitlab.example.com/acme/ai-tools"]), {
            "github.com/chris-peterson/tack": "tack",
            "gitlab.example.com/acme/ai-tools": "ai-tools",
        });
    });
    it("adds the top-level namespace to a shared name", () => {
        assert.deepEqual(labels(["gitlab.example.com/acme/ai-tools", "gitlab.example.com/globex/ai-tools"]), {
            "gitlab.example.com/acme/ai-tools": "acme/ai-tools",
            "gitlab.example.com/globex/ai-tools": "globex/ai-tools",
        });
    });
    it("elides the subgroups between the namespace and the name", () => {
        assert.deepEqual(labels(["gitlab.example.com/acme/platform/kafka", "gitlab.example.com/globex/modules/kafka"]), {
            "gitlab.example.com/acme/platform/kafka": "acme/kafka",
            "gitlab.example.com/globex/modules/kafka": "globex/kafka",
        });
    });
    it("adds the subgroups nearest the name until the label is unique", () => {
        assert.deepEqual(labels([
            "gitlab.example.com/acme/ci",
            "gitlab.example.com/acme/databases/ci",
            "gitlab.example.com/acme/x/one/ci",
            "gitlab.example.com/acme/y/one/ci",
        ]), {
            "gitlab.example.com/acme/ci": "acme/ci",
            "gitlab.example.com/acme/databases/ci": "acme/databases/ci",
            "gitlab.example.com/acme/x/one/ci": "acme/x/one/ci",
            "gitlab.example.com/acme/y/one/ci": "acme/y/one/ci",
        });
    });
    it("tells repos on different forges apart by their owners", () => {
        assert.deepEqual(labels(["github.com/acme/widgets", "gitlab.example.com/globex/widgets"]), {
            "github.com/acme/widgets": "acme/widgets",
            "gitlab.example.com/globex/widgets": "globex/widgets",
        });
    });
    it("adds the host only when two repos share their whole path", () => {
        assert.deepEqual(labels(["github.com/acme/widgets", "gitlab.example.com/acme/widgets", "github.com/acme/other"]), {
            "github.com/acme/widgets": "github.com/acme/widgets",
            "gitlab.example.com/acme/widgets": "gitlab.example.com/acme/widgets",
            "github.com/acme/other": "other",
        });
    });
    it("treats names differing only in case as a collision", () => {
        assert.deepEqual(labels(["github.com/acme/Tools", "github.com/globex/tools"]), {
            "github.com/acme/Tools": "acme/Tools",
            "github.com/globex/tools": "globex/tools",
        });
    });
    it("terminates on keys that differ only in case", () => {
        const out = labels(["github.com/acme/tools", "github.com/Acme/tools"]);
        assert.equal(out["github.com/acme/tools"], "github.com/acme/tools");
        assert.equal(out["github.com/Acme/tools"], "github.com/Acme/tools");
    });
});
describe("labelFor (CLI-60)", () => {
    it("tells a key apart from the repos in the database", () => {
        repos.recordUrl("https://gitlab.example.com/acme/ai-tools/-/issues/1");
        assert.equal(repos.labelFor("gitlab.example.com/globex/ai-tools"), "globex/ai-tools");
        assert.equal(repos.labelFor("gitlab.example.com/acme/ai-tools"), "ai-tools");
    });
});
