// [SERVE-22]: documents name a repo by its shortest unique label ([CLI-60]).
// Labels depend on every repo in the database, so these run in a store of
// their own rather than beside serve.test.ts's repos.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
let route;
let serve;
let repos;
let sessions;
const tmp = mkdtempSync(join(tmpdir(), "tack-serve-labels-test-"));
const config = mkdtempSync(join(tmpdir(), "tack-serve-labels-claude-"));
process.env.TACK_HOME = tmp;
process.env.CLAUDE_CONFIG_DIR = config;
before(async () => {
    route = await import("./route.js");
    serve = await import("./serve.js");
    repos = await import("./repos.js");
    sessions = await import("./sessions.js");
});
after(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(config, { recursive: true, force: true });
});
async function withServer(fn) {
    const server = serve.serve(0, { probe: async () => { throw new Error("no forge in this suite"); } });
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    }
    finally {
        server.close();
    }
}
describe("repo labels in documents", () => {
    it("labels a deliverable by its repo's shortest unique name", async () => {
        route.init("twins");
        route.addTack("twins", "acme's half");
        route.setDeliverable("twins", "t1", "ai-tools!3", "https://gitlab.example.com/acme/ai-tools/-/merge_requests/3");
        route.addTack("twins", "globex's half");
        route.setDeliverable("twins", "t2", "ai-tools!4", "https://gitlab.example.com/globex/ai-tools/-/merge_requests/4");
        route.addTack("twins", "named by hand");
        route.setDeliverable("twins", "t3", "Adopt image retention", "https://gitlab.example.com/acme/ai-tools/-/merge_requests/5");
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/route/twins`)).text();
            assert.match(body, /<a href="[^"]*\/merge_requests\/3">acme\/ai-tools!3<\/a>/);
            assert.match(body, /<a href="[^"]*\/merge_requests\/4">globex\/ai-tools!4<\/a>/);
            // A label someone wrote stays readable, on hover.
            assert.match(body, /<a href="[^"]*\/merge_requests\/5" title="Adopt image retention">acme\/ai-tools!5<\/a>/);
        });
    });
    it("labels a link carrying the derived label, and keeps one someone wrote", async () => {
        route.init("linked");
        route.addTack("linked", "work");
        route.addLink("linked", "t1", "ai-tools#8", "https://gitlab.example.com/globex/ai-tools/-/issues/8");
        route.addLink("linked", "t1", "the issue", "https://gitlab.example.com/acme/ai-tools/-/issues/9");
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/route/linked/t1`)).text();
            assert.match(body, /<a href="[^"]*\/issues\/8">globex\/ai-tools#8<\/a>/);
            assert.match(body, /<a href="[^"]*\/issues\/9">the issue<\/a>/);
        });
    });
    it("names where a session ran by its repo's unique label and the path inside it", async () => {
        const checkout = (owner) => {
            const dir = join(tmp, "checkouts", owner, "docs");
            mkdirSync(join(dir, "src", "lib"), { recursive: true });
            execFileSync("git", ["init", "-q", dir]);
            execFileSync("git", ["-C", dir, "remote", "add", "origin", `git@github.com:${owner}/docs.git`]);
            repos.recordCwd(dir);
            return dir;
        };
        const acme = checkout("acme");
        const initech = checkout("initech");
        route.init("ran");
        route.addTack("ran", "work");
        const dir = join(config, "projects", "-ran");
        mkdirSync(dir, { recursive: true });
        const transcript = (id, cwd) => {
            sessions.record(id, "ran", "t1");
            writeFileSync(join(dir, `${id}.jsonl`), JSON.stringify({ type: "user", timestamp: "2026-10-15T18:00:00Z", cwd }));
        };
        transcript("sess-acme", acme);
        transcript("sess-initech", join(initech, "src", "lib"));
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/route/ran/t1/stats`)).text();
            assert.match(body, /<td>acme\/docs<\/td>/);
            assert.match(body, /<td>initech\/docs\/src\/lib<\/td>/);
        });
    });
});
