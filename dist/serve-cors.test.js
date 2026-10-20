// [SERVE-23]: which browser origins may read and write through `tack serve`.
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
let route;
let serve;
let config;
const tmp = mkdtempSync(join(tmpdir(), "tack-serve-cors-test-"));
const xdg = mkdtempSync(join(tmpdir(), "tack-serve-cors-xdg-"));
process.env.TACK_HOME = tmp;
const DASHBOARD = "https://dash.example.com";
before(async () => {
    route = await import("./route.js");
    serve = await import("./serve.js");
    config = await import("./config.js");
    route.init("cors");
});
after(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(xdg, { recursive: true, force: true });
});
afterEach(() => {
    delete process.env.XDG_CONFIG_HOME;
    rmSync(join(xdg, "tack"), { recursive: true, force: true });
});
function writeConfig(body) {
    mkdirSync(join(xdg, "tack"), { recursive: true });
    writeFileSync(join(xdg, "tack", "config.yaml"), body);
    process.env.XDG_CONFIG_HOME = xdg;
}
// node:http rather than fetch, which treats Origin as the caller's to set.
function call(server, method, path, headers, body = "") {
    const { port } = server.address();
    return new Promise((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
            res.resume();
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
        });
        req.on("error", reject);
        req.end(body);
    });
}
async function withServer(fn) {
    const server = serve.serve(0);
    await new Promise((r) => server.once("listening", r));
    try {
        await fn(server);
    }
    finally {
        server.close();
    }
}
const form = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
describe("allowed origins", () => {
    it("allows no browser origin when there is no config", async () => {
        await withServer(async (s) => {
            const read = await call(s, "GET", "/", { origin: DASHBOARD, accept: "application/json" });
            assert.equal(read.status, 200);
            assert.equal(read.headers["access-control-allow-origin"], undefined);
            assert.equal((await call(s, "OPTIONS", "/route/cors/edit", { origin: DASHBOARD })).status, 403);
            assert.equal((await call(s, "POST", "/route/cors/edit", { origin: DASHBOARD, ...form }, "title=x")).status, 403);
        });
    });
    it("lets a listed origin read and write, and no other", async () => {
        writeConfig(`allowed_origins:\n  - ${DASHBOARD}\n`);
        await withServer(async (s) => {
            const read = await call(s, "GET", "/route/cors", { origin: DASHBOARD, accept: "application/json" });
            assert.equal(read.headers["access-control-allow-origin"], DASHBOARD);
            assert.equal(read.headers.vary, "Origin");
            const preflight = await call(s, "OPTIONS", "/route/cors/edit", {
                origin: DASHBOARD,
                "access-control-request-method": "POST",
            });
            assert.equal(preflight.status, 204);
            assert.equal(preflight.headers["access-control-allow-origin"], DASHBOARD);
            assert.equal(preflight.headers["access-control-allow-methods"], "POST, OPTIONS");
            const write = await call(s, "POST", "/route/cors/edit", { origin: DASHBOARD, ...form }, "title=From%20the%20dashboard");
            assert.equal(write.status, 200);
            assert.equal(write.headers["access-control-allow-origin"], DASHBOARD);
            assert.equal(route.load("cors").title, "From the dashboard");
            const other = "https://elsewhere.example.com";
            const foreign = await call(s, "GET", "/", { origin: other, accept: "application/json" });
            assert.equal(foreign.headers["access-control-allow-origin"], undefined);
            assert.equal((await call(s, "POST", "/route/cors/edit", { origin: other, ...form }, "title=x")).status, 403);
            // An opaque origin is one any page can produce on demand.
            assert.equal((await call(s, "POST", "/route/cors/edit", { origin: "null", ...form }, "title=x")).status, 403);
        });
    });
    it("gives a loopback page read access only when it is listed", async () => {
        const local = "http://localhost:5173";
        await withServer(async (s) => {
            const unlisted = await call(s, "GET", "/", { origin: local, accept: "application/json" });
            assert.equal(unlisted.headers["access-control-allow-origin"], undefined);
            // [SERVE-13]: a loopback page could already write; listing changes nothing there.
            assert.equal((await call(s, "POST", "/route/cors/edit", { origin: local, ...form }, "title=Local")).status, 200);
        });
        writeConfig(`allowed_origins:\n  - ${local}\n`);
        await withServer(async (s) => {
            const listed = await call(s, "GET", "/", { origin: local, accept: "application/json" });
            assert.equal(listed.headers["access-control-allow-origin"], local);
        });
    });
});
describe("the serve config file", () => {
    it("reads as no origins when absent", () => {
        process.env.XDG_CONFIG_HOME = xdg;
        assert.deepEqual(config.allowedOrigins(), []);
    });
    it("refuses an entry that is not an origin, naming the origin it holds", () => {
        writeConfig(`allowed_origins:\n  - "https://cpeterson.pages.getty.cloud/goals/#goals"\n`);
        assert.throws(() => config.allowedOrigins(), /not an origin.*https:\/\/cpeterson\.pages\.getty\.cloud"/);
    });
    it("refuses a file that is not YAML rather than serving without it", () => {
        writeConfig("allowed_origins: [");
        assert.throws(() => config.allowedOrigins(), /config\.yaml is not valid YAML/);
    });
    it("refuses allowed_origins that is not a list", () => {
        writeConfig("allowed_origins: https://dash.example.com\n");
        assert.throws(() => config.allowedOrigins(), /must be a list of origins/);
    });
});
