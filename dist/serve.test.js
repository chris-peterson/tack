import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    it("refuses a method it has no route for", async () => {
        await withServer(async (base) => {
            // POST is routed now, but only at the edit path — anywhere else it is a
            // missing document, not a rejected method.
            assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 404);
            assert.equal((await fetch(`${base}/`, { method: "DELETE" })).status, 405);
            assert.equal((await fetch(`${base}/route/x`, { method: "PUT" })).status, 405);
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
describe("editing a route from the page", () => {
    async function post(base, slug, body, headers = {}) {
        return fetch(`${base}/route/${slug}/edit`, {
            method: "POST",
            redirect: "manual",
            headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
            body,
        });
    }
    it("sets a title and redirects back to the document", async () => {
        route.init("ed-title");
        await withServer(async (base) => {
            const res = await post(base, "ed-title", "title=Renamed+from+the+page");
            assert.equal(res.status, 303);
            assert.equal(res.headers.get("location"), "/route/ed-title");
            assert.equal(route.load("ed-title").title, "Renamed from the page");
        });
    });
    it("sets a description, normalizing the CRLF a browser sends", async () => {
        route.init("ed-desc");
        await withServer(async (base) => {
            await post(base, "ed-desc", "description=" + encodeURIComponent("one\r\ntwo\r\n"));
            assert.equal(route.load("ed-desc").description, "one\ntwo");
        });
    });
    it("clears the field when it comes back empty", async () => {
        route.init("ed-clear");
        route.setTitle("ed-clear", "Doomed");
        route.setDescription("ed-clear", "Also doomed");
        await withServer(async (base) => {
            await post(base, "ed-clear", "title=&description=");
            const r = route.load("ed-clear");
            assert.equal(r.title, undefined);
            assert.equal(r.description, undefined);
        });
    });
    it("leaves a field alone when the form omits it", async () => {
        route.init("ed-partial");
        route.setTitle("ed-partial", "Kept");
        await withServer(async (base) => {
            await post(base, "ed-partial", "description=new+prose");
            const r = route.load("ed-partial");
            assert.equal(r.title, "Kept");
            assert.equal(r.description, "new prose");
        });
    });
    it("refuses a write carrying a foreign Origin", async () => {
        route.init("ed-csrf");
        route.setTitle("ed-csrf", "Untouched");
        await withServer(async (base) => {
            const res = await post(base, "ed-csrf", "title=Hijacked", { origin: "https://evil.example.com" });
            assert.equal(res.status, 403);
            assert.equal(route.load("ed-csrf").title, "Untouched");
        });
    });
    it("accepts a write from the page's own origin", async () => {
        route.init("ed-same");
        await withServer(async (base) => {
            const res = await post(base, "ed-same", "title=Fine", { origin: base });
            assert.equal(res.status, 303);
            assert.equal(route.load("ed-same").title, "Fine");
        });
    });
    it("404s a POST at a path that accepts none", async () => {
        await withServer(async (base) => {
            const res = await fetch(`${base}/route/whatever`, { method: "POST", redirect: "manual" });
            assert.equal(res.status, 404);
        });
    });
    it("404s an edit to a route that does not exist", async () => {
        await withServer(async (base) => {
            assert.equal((await post(base, "ghost", "title=x")).status, 404);
        });
    });
    it("answers a JSON client with the updated route instead of a redirect", async () => {
        route.init("ed-json");
        await withServer(async (base) => {
            const res = await post(base, "ed-json", "title=Via+API", { accept: "application/json" });
            assert.equal(res.status, 200);
            const body = (await res.json());
            assert.equal(body.title, "Via API");
        });
    });
    it("offers the form on a route document but not in a group view", async () => {
        route.init("ed-form", { group: "formteam" });
        await withServer(async (base) => {
            assert.match(await (await fetch(`${base}/route/ed-form`)).text(), /action="\/route\/ed-form\/edit"/);
            assert.doesNotMatch(await (await fetch(`${base}/group/formteam`)).text(), /<form/);
        });
    });
});
describe("description markdown", () => {
    async function descHtml(base, slug) {
        const body = await (await fetch(`${base}/route/${slug}`)).text();
        return body.match(/<div class="desc">([\s\S]*?)<\/div>/)?.[1] ?? "";
    }
    it("renders bold, italic, and inline code", async () => {
        route.init("md-inline");
        route.setDescription("md-inline", "**bold** and *italic* and `code`");
        await withServer(async (base) => {
            const html = await descHtml(base, "md-inline");
            assert.match(html, /<strong>bold<\/strong>/);
            assert.match(html, /<em>italic<\/em>/);
            assert.match(html, /<code>code<\/code>/);
        });
    });
    it("renders headings, lists, and fenced code", async () => {
        route.init("md-block");
        route.setDescription("md-block", "## Plan\n\n- one\n- two\n\n1. first\n\n```\nliteral\n```");
        await withServer(async (base) => {
            const html = await descHtml(base, "md-block");
            assert.match(html, /<h2>Plan<\/h2>/);
            assert.match(html, /<li>one<\/li>/);
            assert.match(html, /<ol>[\s\S]*<li>first<\/li>/);
            assert.match(html, /<pre><code>literal\n<\/code><\/pre>/);
        });
    });
    it("renders a link, and only for http(s)", async () => {
        route.init("md-link");
        route.setDescription("md-link", "[docs](https://example.com/x) and [bad](javascript:alert(1))");
        await withServer(async (base) => {
            const html = await descHtml(base, "md-link");
            assert.match(html, /<a href="https:\/\/example\.com\/x">docs<\/a>/);
            assert.doesNotMatch(html, /href="javascript:/);
        });
    });
    it("refuses a data: link too", async () => {
        route.init("md-data");
        route.setDescription("md-data", "[x](data:text/html,<script>alert(1)</script>)");
        await withServer(async (base) => {
            assert.doesNotMatch(await descHtml(base, "md-data"), /href="data:/);
        });
    });
    it("escapes rather than passes through raw HTML in the source", async () => {
        route.init("md-xss");
        route.setDescription("md-xss", "<img src=x onerror=alert(1)> **still bold**");
        await withServer(async (base) => {
            const html = await descHtml(base, "md-xss");
            assert.doesNotMatch(html, /<img/);
            assert.match(html, /&lt;img/);
            assert.match(html, /<strong>still bold<\/strong>/);
        });
    });
    it("keeps paragraphs separate", async () => {
        route.init("md-para");
        route.setDescription("md-para", "first para\n\nsecond para");
        await withServer(async (base) => {
            const html = await descHtml(base, "md-para");
            assert.match(html, /<p>first para<\/p>/);
            assert.match(html, /<p>second para<\/p>/);
        });
    });
    it("leaves the editor showing the source, not the rendering", async () => {
        route.init("md-source");
        route.setDescription("md-source", "**bold**");
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/route/md-source`)).text();
            assert.match(body, /<textarea[^>]*>\*\*bold\*\*<\/textarea>/);
        });
    });
});
describe("group documents link out to each tack", () => {
    it("points every tack at its own route's anchor", async () => {
        route.init("ga", { group: "linked" });
        route.addTack("ga", "one");
        route.init("gb", { group: "linked" });
        route.addTack("gb", "two");
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/group/linked`)).text();
            assert.match(body, /href="\/route\/ga#t1"/);
            assert.match(body, /href="\/route\/gb#t1"/);
            assert.match(body, /href="\/route\/ga"/);
        });
    });
    // Several routes render into one group document, and each numbers its tacks
    // from t1 — so anchoring them in place would emit the same id repeatedly and
    // a link to #t1 would land on whichever came first.
    it("emits no duplicate anchors across the routes it combines", async () => {
        route.init("da", { group: "dup" });
        route.addTack("da", "one");
        route.init("db", { group: "dup" });
        route.addTack("db", "also one");
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/group/dup`)).text();
            assert.equal(body.match(/id="t1"/g), null);
        });
    });
    it("still anchors tacks in a single route document", async () => {
        route.init("anchored");
        route.addTack("anchored", "work");
        await withServer(async (base) => {
            assert.match(await (await fetch(`${base}/route/anchored`)).text(), /id="t1"/);
        });
    });
});
// Issue #49: one route file the scan cannot read used to 500 every path, the
// index included. The refusal now belongs to that route's own document.
describe("a route file that will not load", () => {
    function writeBadRoute(slug) {
        route.init(slug);
        route.addTack(slug, "a tack");
        const path = join(tmp, "routes", `${slug}.yaml`);
        writeFileSync(path, readFileSync(path, "utf-8").replace(/\n$/, "") +
            `\n    after:\n      - id: a1\n        text: ${"x".repeat(1200)}\n        done: false\n`);
    }
    it("leaves the index serving the routes it could read", async () => {
        route.init("readable");
        writeBadRoute("unreadable");
        await withServer(async (base) => {
            const res = await fetch(`${base}/`);
            assert.equal(res.status, 200);
            assert.match(await res.text(), /readable/);
        });
    });
    it("names the file it left out, on the index itself", async () => {
        route.init("readable");
        writeBadRoute("unreadable");
        await withServer(async (base) => {
            const body = await (await fetch(`${base}/`)).text();
            assert.match(body, /unreadable\.yaml/);
            assert.match(body, /tack doctor/);
        });
    });
    // SERVE-04: the documents inherit the CLI's refusal to render work it could
    // not read — for the document that would have rendered it, and no other.
    it("still refuses the unreadable route's own document", async () => {
        writeBadRoute("unreadable");
        await withServer(async (base) => {
            const res = await fetch(`${base}/route/unreadable`);
            assert.equal(res.status, 500);
            assert.match(await res.text(), /must NOT have more than 1000 characters/);
        });
    });
    it("still 404s a route that was never there", async () => {
        writeBadRoute("unreadable");
        await withServer(async (base) => {
            assert.equal((await fetch(`${base}/route/never-existed`)).status, 404);
        });
    });
});
