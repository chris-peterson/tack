import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { request } from "node:http";

let route: typeof import("./route.js");
let serve: typeof import("./serve.js");

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
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = serve.serve(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
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
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          { host: "127.0.0.1", port, path: "/", headers: { Host: "evil.example.com" } },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
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
    assert.equal(
      serve.hyperlinkBase({ TACK_HYPERLINKS: "1", TACK_SERVE_PORT: "9001" }, false),
      "http://127.0.0.1:9001",
    );
  });
});
