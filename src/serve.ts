import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import * as route from "./route.js";
import type { Route, Tack, TodoItem } from "./types.js";

// beacon holds 8787 and these two sit side by side on one machine, so tack
// takes the next port up.
export const DEFAULT_PORT = 8788;

// Where `tack status` points its hyperlinks. Returns null when the terminal
// would print the escape sequence instead of acting on it — piped output, a
// dumb terminal, or one of the many emulators that never implemented OSC 8.
//
// Deliberately not a reachability check: probing the port on every `tack
// status` costs a round trip to answer a question the browser answers for free
// when the link is followed, so a link to a server that isn't running is left
// to fail at click time. `TACK_HYPERLINKS=0`/`1` overrides the detection.
export function hyperlinkBase(env = process.env, isTty = process.stdout.isTTY): string | null {
  const forced = env.TACK_HYPERLINKS;
  const port = env.TACK_SERVE_PORT ? parseInt(env.TACK_SERVE_PORT, 10) : DEFAULT_PORT;
  const base = `http://127.0.0.1:${Number.isNaN(port) ? DEFAULT_PORT : port}`;

  if (forced === "0") return null;
  if (forced === "1") return base;
  if (!isTty || env.TERM === "dumb") return null;

  const known = ["iTerm.app", "WezTerm", "ghostty", "vscode", "Hyper"];
  if (known.includes(env.TERM_PROGRAM ?? "")) return base;
  if ((env.TERM ?? "").includes("kitty")) return base;
  // GNOME Terminal and other VTE emulators gained OSC 8 in 0.50.
  if (parseInt(env.VTE_VERSION ?? "0", 10) >= 5000) return base;
  return null;
}

// Everything rendered here comes from route files a person hand-edits, so every
// interpolation is escaped. The one exception is a URL, which is escaped *and*
// scheme-checked below: an attribute-escaped `javascript:` href is still live.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? esc(url) : null;
}

function link(label: string, url: string): string {
  const href = safeHref(url);
  return href ? `<a href="${href}">${esc(label)}</a>` : esc(`${label} (${url})`);
}

const STYLE = `
:root {
  color-scheme: light dark;
  --fg: #16191d; --muted: #5c6570; --bg: #fbfbfa; --card: #fff;
  --line: #e3e5e8; --accent: #1f6feb; --done: #1a7f37;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e6e8ea; --muted: #9aa4af; --bg: #14171a; --card: #1b1f23;
    --line: #2b3137; --accent: #6ea8ff; --done: #46c164;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2.5rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
}
main { max-width: 52rem; margin: 0 auto; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
     color: var(--muted); margin: 2.25rem 0 .75rem; font-weight: 600; }
.crumb { font-size: .85rem; color: var(--muted); margin-bottom: 1.5rem; }
.sub { color: var(--muted); margin: 0 0 1.5rem; }
.desc { margin: 0 0 1.5rem; white-space: pre-wrap; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
        padding: .85rem 1rem; margin-bottom: .5rem; }
.card.done { opacity: .72; }
.tid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem;
       color: var(--muted); margin-right: .5rem; }
.pill { display: inline-block; font-size: .72rem; padding: .1rem .5rem; border-radius: 999px;
        border: 1px solid var(--line); color: var(--muted); margin-left: .5rem; vertical-align: 1px; }
.pill.done { color: var(--done); border-color: currentColor; }
.meta { font-size: .85rem; color: var(--muted); margin-top: .4rem; }
.meta ul { margin: .25rem 0 0; padding-left: 1.1rem; }
.row { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; }
.empty { color: var(--muted); font-style: italic; }
footer { max-width: 52rem; margin: 3rem auto 0; color: var(--muted); font-size: .8rem;
         border-top: 1px solid var(--line); padding-top: 1rem; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main>
<footer>Rendered from <code>~/.tack/routes</code> on each request — <code>tack serve</code></footer>
</body></html>`;
}

function todoList(items: TodoItem[] | undefined, label: string): string {
  if (!items?.length) return "";
  const rows = items
    .map((i) => `<li>${i.done ? "&#10003;" : "&#9744;"} ${esc(i.text)}</li>`)
    .join("");
  return `<div class="meta">${label}<ul>${rows}</ul></div>`;
}

function tackCard(t: Tack): string {
  const done = t.status === "done";
  const meta: string[] = [];
  if (t.deliverable) meta.push(`deliverable: ${link(t.deliverable.label, t.deliverable.url)}`);
  if (t.depends_on?.length) meta.push(`depends on ${esc(t.depends_on.join(", "))}`);
  for (const l of t.links ?? []) meta.push(link(l.label, l.url));

  return `<div class="card${done ? " done" : ""}" id="${esc(t.id)}">
  <div class="row"><div><span class="tid">${esc(t.id)}</span>${esc(t.summary)}</div>
  <span class="pill${done ? " done" : ""}">${esc(t.status)}</span></div>
  ${meta.length ? `<div class="meta">${meta.join(" &middot; ")}</div>` : ""}
  ${todoList(t.before, "before")}${todoList(t.after, "after")}
</div>`;
}

export function renderRoute(r: Route, opts: { crumb?: boolean } = {}): string {
  const state = route.routeState(r);
  const open = r.tacks.filter(route.isOpen).length;
  const head = `<div class="row"><h1>${esc(r.title ?? r.slug)}</h1>
    <span class="pill${state === "done" ? " done" : ""}">${state}</span></div>
    <p class="sub">${esc(r.slug)} &middot; ${open} open / ${r.tacks.length} total${
      r.group ? ` &middot; <a href="/group/${esc(r.group)}">${esc(r.group)}</a>` : ""
    }</p>`;

  const deps = r.depends_on?.length
    ? `<div class="meta">depends on routes: ${r.depends_on
        .map((d) => `<a href="/route/${esc(d)}">${esc(d)}</a>`)
        .join(", ")}</div>`
    : "";

  const tacks = r.tacks.length
    ? r.tacks.map(tackCard).join("")
    : `<p class="empty">No tacks yet.</p>`;

  return `${opts.crumb === false ? "" : `<div class="crumb"><a href="/">all routes</a></div>`}
${head}${r.description ? `<div class="desc">${esc(r.description)}</div>` : ""}${deps}
<h2>Tacks</h2>${tacks}`;
}

export function renderIndex(routes: Route[]): string {
  if (routes.length === 0) {
    return `<h1>tack</h1><p class="empty">No routes yet — <code>tack init &lt;slug&gt;</code>.</p>`;
  }

  // Grouped first, in group order; ungrouped last, so the reader meets the
  // organized half of their work before the loose ends.
  const groups = new Map<string, Route[]>();
  const loose: Route[] = [];
  for (const r of [...routes].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (r.group) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
    else loose.push(r);
  }

  const card = (r: Route): string => {
    const state = route.routeState(r);
    const open = r.tacks.filter(route.isOpen).length;
    return `<div class="card${state === "done" ? " done" : ""}"><div class="row">
      <div><a href="/route/${esc(r.slug)}">${esc(r.slug)}</a>${
        r.title ? ` <span class="meta">${esc(r.title)}</span>` : ""
      }</div>
      <span class="pill${state === "done" ? " done" : ""}">${open} open / ${r.tacks.length}</span>
    </div></div>`;
  };

  const sections = [...groups.keys()].sort().map(
    (g) => `<h2><a href="/group/${esc(g)}">${esc(g)}</a></h2>${groups.get(g)!.map(card).join("")}`,
  );
  if (loose.length) sections.push(`<h2>ungrouped</h2>${loose.map(card).join("")}`);

  return `<h1>tack</h1><p class="sub">${routes.length} routes</p>${sections.join("")}`;
}

export function renderGroup(group: string, routes: Route[]): string {
  const body = routes.map((r) => renderRoute(r, { crumb: false })).join('<hr style="border:0">');
  return `<div class="crumb"><a href="/">all routes</a></div><h1>${esc(group)}</h1>
    <p class="sub">${routes.length} routes</p>${body}`;
}

// A rebound hostname resolving to 127.0.0.1 lets a page in the user's browser
// read these documents, so the Host header has to name loopback too. Read-only
// today; the issue's follow-up adds writes beside these routes, and this is the
// check that has to already be here when it does.
function loopbackHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function send(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

// One URL per thing, two representations: the document a person reads and the
// JSON a program parses. A separate `/api` tree would make the same route
// addressable two ways, and then one of the two spellings ends up in someone's
// bookmark or dashboard config while the other is the one that gets maintained.
//
// HTML is the default: a bare `*/*` (curl, most fetch defaults) gets the
// document, and only an explicit preference for JSON switches. Quality values
// decide when both are named, so `text/html;q=0.8, application/json` is a JSON
// request even though HTML is listed first.
export function prefersJson(accept: string | undefined): boolean {
  if (!accept) return false;

  const q = (type: string, wildcard: string): number => {
    for (const part of accept.split(",")) {
      const [mime, ...params] = part.trim().split(";");
      if (mime.trim() !== type && mime.trim() !== wildcard) continue;
      const qp = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return qp ? parseFloat(qp.slice(2)) || 0 : 1;
    }
    // Absent, not merely low-priority: `*/*` must not count as asking for JSON.
    return -1;
  };

  return q("application/json", "application/*") > q("text/html", "text/*");
}

// The JSON representation matches what the CLI's own `--json` emits, down to
// the derived `state` key, so a consumer can move between `tack list --json`
// and this server without reshaping anything.
function routeJson(r: Route): Route & { state: string } {
  return { ...r, state: route.routeState(r) };
}

export function handle(req: IncomingMessage, res: ServerResponse): void {
  const json = prefersJson(req.headers.accept);
  const fail = (status: number, message: string): void =>
    json
      ? sendJson(res, status, { error: message })
      : send(res, status, page("tack", `<h1>${status}</h1><p>${esc(message)}</p>`));

  if (!loopbackHost(req)) return fail(403, "Host must be loopback.");
  if (req.method !== "GET") return fail(405, `${req.method} not allowed; these documents are read-only.`);

  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);

  // Read on every request rather than caching: the CLI writes these files
  // behind the server's back, and a stale document that disagrees with
  // `tack status` is worse than no document.
  let routes: Route[];
  try {
    routes = route.loadAll();
  } catch (e) {
    return fail(500, (e as Error).message);
  }

  if (path === "/") {
    return json
      ? sendJson(res, 200, routes.map(routeJson))
      : send(res, 200, page("tack", renderIndex(routes)));
  }

  const routeMatch = path.match(/^\/route\/([^/]+)\/?$/);
  if (routeMatch) {
    const r = routes.find((x) => x.slug === routeMatch[1]);
    if (!r) return fail(404, `No route ${routeMatch[1]}.`);
    return json ? sendJson(res, 200, routeJson(r)) : send(res, 200, page(r.slug, renderRoute(r)));
  }

  const groupMatch = path.match(/^\/group\/([^/]+)\/?$/);
  if (groupMatch) {
    const inGroup = routes.filter((x) => x.group === groupMatch[1]);
    if (!inGroup.length) return fail(404, `No group ${groupMatch[1]}.`);
    return json
      ? sendJson(res, 200, inGroup.map(routeJson))
      : send(res, 200, page(groupMatch[1], renderGroup(groupMatch[1], inGroup)));
  }

  fail(404, `No document at ${path}.`);
}

export function serve(port = DEFAULT_PORT): Server {
  return createServer(handle).listen(port, "127.0.0.1");
}
