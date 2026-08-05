import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
let route;
let serve;
const tmp = mkdtempSync(join(tmpdir(), "tack-serve-test-"));
process.env.TACK_HOME = tmp;
before(async () => {
    route = await import("./route.js");
    serve = await import("./serve.js");
});
after(() => {
    rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
    rmSync(join(tmp, "routes"), { recursive: true, force: true });
});
// Port 0 lets the OS pick, so a developer already running `tack serve` doesn't
// collide with the suite.
async function withServer(fn) {
    const server = serve.serve(0);
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    }
    finally {
        server.close();
    }
}
describe("serve documents", () => {
    it("serves an index of every route", async () => {
        route.init("alpha", { group: "ai" });
        route.addTack("alpha", "first");
        route.init("beta");
        await withServer(async (base) => {
            const res = await fetch(`${base}/`);
            const body = await res.text();
            assert.equal(res.status, 200);
            assert.match(body, /alpha/);
            assert.match(body, /beta/);
            assert.match(body, /ungrouped/);
        });
    });
    it("serves one route with its tacks anchored by id", async () => {
        route.init("gamma");
        route.addTack("gamma", "the work");
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/route/gamma`)).text();
            assert.match(body, /the work/);
            assert.match(body, /id="t1"/);
        });
    });
    it("serves a group as one document", async () => {
        route.init("g1", { group: "team" });
        route.init("g2", { group: "team" });
        await withServer(async (base) => {
            const res = await fetch(`${base}/group/team`);
            const body = await res.text();
            assert.equal(res.status, 200);
            assert.match(body, /g1/);
            assert.match(body, /g2/);
        });
    });
    it("404s an unknown slug rather than rendering an empty document", async () => {
        await withServer(async (base) => {
            const res = await fetch(`${base}/route/nope`);
            assert.equal(res.status, 404);
            assert.match(await res.text(), /No route nope/);
        });
    });
    it("404s an empty group", async () => {
        await withServer(async (base) => {
            assert.equal((await fetch(`${base}/group/nobody`)).status, 404);
        });
    });
    it("reflects an edit without a restart", async () => {
        route.init("live");
        await withServer(async (base) => {
            assert.doesNotMatch(await (await fetch(`${base}/route/live`)).text(), /added later/);
            route.addTack("live", "added later");
            assert.match(await (await fetch(`${base}/route/live`)).text(), /added later/);
        });
    });
    // `Host` is a forbidden header name for fetch(), which drops the override
    // without telling you — so this one goes through node:http directly.
    it("refuses a request whose Host is not loopback", async () => {
        await withServer(async (base) => {
            const port = Number(new URL(base).port);
            const status = await new Promise((resolve, reject) => {
                const req = request({ host: "127.0.0.1", port, path: "/", headers: { Host: "evil.example.com" } }, (res) => {
                    res.resume();
                    resolve(res.statusCode ?? 0);
                });
                req.on("error", reject);
                req.end();
            });
            assert.equal(status, 403);
        });
    });
    it("refuses a method other than GET", async () => {
        await withServer(async (base) => {
            assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
        });
    });
    it("escapes route content rather than rendering it as markup", async () => {
        route.init("xss");
        route.addTack("xss", "<script>alert(1)</script>");
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/route/xss`)).text();
            assert.doesNotMatch(body, /<script>alert/);
            assert.match(body, /&lt;script&gt;/);
        });
    });
    it("does not turn a non-http deliverable into a live link", () => {
        const r = route.init("scheme");
        route.addTack("scheme", "work", {
            deliverable: { label: "x", url: "javascript:alert(1)" },
        });
        const html = serve.renderRoute(route.load(r.slug));
        assert.doesNotMatch(html, /href="javascript:/);
    });
});
describe("hyperlink detection", () => {
    const base = "http://127.0.0.1:8788";
    it("stays quiet when stdout is not a TTY", () => {
        assert.equal(serve.hyperlinkBase({ TERM_PROGRAM: "iTerm.app" }, false), null);
    });
    it("stays quiet on a terminal with no OSC 8 support", () => {
        assert.equal(serve.hyperlinkBase({ TERM_PROGRAM: "Apple_Terminal" }, true), null);
    });
    it("links on a terminal that supports it", () => {
        assert.equal(serve.hyperlinkBase({ TERM_PROGRAM: "iTerm.app" }, true), base);
        assert.equal(serve.hyperlinkBase({ TERM: "xterm-kitty" }, true), base);
        assert.equal(serve.hyperlinkBase({ VTE_VERSION: "6003" }, true), base);
    });
    it("honors an explicit override in both directions", () => {
        assert.equal(serve.hyperlinkBase({ TACK_HYPERLINKS: "1" }, false), base);
        assert.equal(serve.hyperlinkBase({ TACK_HYPERLINKS: "0", TERM_PROGRAM: "iTerm.app" }, true), null);
    });
    it("follows TACK_SERVE_PORT so links match a server on another port", () => {
        assert.equal(serve.hyperlinkBase({ TACK_HYPERLINKS: "1", TACK_SERVE_PORT: "9001" }, false), "http://127.0.0.1:9001");
    });
});
describe("content negotiation", () => {
    it("defaults to the document for a bare */* (curl, most fetch defaults)", () => {
        assert.equal(serve.prefersJson("*/*"), false);
        assert.equal(serve.prefersJson(undefined), false);
    });
    it("defaults to the document for a browser's Accept", () => {
        assert.equal(serve.prefersJson("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), false);
    });
    it("switches on an explicit JSON preference", () => {
        assert.equal(serve.prefersJson("application/json"), true);
        assert.equal(serve.prefersJson("application/*"), true);
    });
    it("reads quality values rather than order", () => {
        assert.equal(serve.prefersJson("text/html;q=0.8, application/json"), true);
        assert.equal(serve.prefersJson("application/json;q=0.5, text/html"), false);
    });
    it("serves a route as JSON matching the CLI's --json shape", async () => {
        route.init("neg", { group: "ai" });
        route.addTack("neg", "work");
        await withServer(async (base) => {
            const res = await fetch(`${base}/route/neg`, { headers: { accept: "application/json" } });
            assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
            const body = (await res.json());
            assert.equal(body.slug, "neg");
            assert.equal(body.state, "active");
            assert.equal(body.tacks.length, 1);
        });
    });
    it("serves the index and a group as JSON arrays", async () => {
        route.init("j1", { group: "team" });
        route.init("j2", { group: "team" });
        await withServer(async (base) => {
            const all = (await (await fetch(`${base}/`, { headers: { accept: "application/json" } })).json());
            assert.equal(all.length, 2);
            const group = (await (await fetch(`${base}/group/team`, { headers: { accept: "application/json" } })).json());
            assert.equal(group.length, 2);
        });
    });
    it("reports a 404 as JSON when JSON was asked for", async () => {
        await withServer(async (base) => {
            const res = await fetch(`${base}/route/nope`, { headers: { accept: "application/json" } });
            assert.equal(res.status, 404);
            assert.deepEqual(await res.json(), { error: "No route nope." });
        });
    });
    it("serves the same URL both ways", async () => {
        route.init("both");
        await withServer(async (base) => {
            const html = await fetch(`${base}/route/both`);
            assert.match(html.headers.get("content-type") ?? "", /text\/html/);
            const json = await fetch(`${base}/route/both`, { headers: { accept: "application/json" } });
            assert.match(json.headers.get("content-type") ?? "", /application\/json/);
        });
    });
});
