import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createRequire } from "node:module";
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

// A description is stored as markdown ([ROUTE-04]). The terminal prints it
// verbatim, which is right there — but a browser showing literal `**bold**` is
// an unrendered document.
//
// markdown-it rather than a hand-rolled subset, and rather than marked, for the
// defaults: raw HTML in the source is escaped instead of passed through, and
// `javascript:`/`data:` links are refused. That matters because a description
// is not always something the user typed — `tack describe --file -` is
// documented as taking an issue body straight off a forge — and this page can
// now POST edits from its own origin, so script running in it would be script
// with write access.
//
// Loaded on first render rather than at import: `cli.ts` pulls this module in
// for `hyperlinkBase()` on every invocation, and no plain CLI command should
// pay to parse a markdown engine it will not use.
let md: { render(src: string): string } | null = null;

function markdown(src: string): string {
  if (!md) {
    const require = createRequire(import.meta.url);
    const MarkdownIt = require("markdown-it");
    md = new MarkdownIt({ linkify: true, typographer: false }) as { render(src: string): string };
  }
  return md.render(src);
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
.desc { margin: 0 0 1.5rem; }
.desc > :first-child { margin-top: 0; }
.desc > :last-child { margin-bottom: 0; }
.desc p { margin: 0 0 .85rem; }
.desc h1, .desc h2, .desc h3, .desc h4, .desc h5, .desc h6 {
  /* Headings inside a description are the author's, not the page's — they must
     not inherit the uppercase section-label styling of the document's own h2. */
  margin: 1.5rem 0 .5rem; text-transform: none; letter-spacing: normal;
  color: var(--fg); font-weight: 600;
}
.desc h1 { font-size: 1.25rem; }
.desc h2 { font-size: 1.1rem; }
.desc h3, .desc h4, .desc h5, .desc h6 { font-size: 1rem; }
.desc blockquote { margin: 0 0 .85rem; padding-left: .9rem;
                   border-left: 3px solid var(--line); color: var(--muted); }
.desc table { border-collapse: collapse; margin: 0 0 .85rem; font-size: .9rem; }
.desc th, .desc td { border: 1px solid var(--line); padding: .3rem .6rem; text-align: left; }
.desc hr { border: 0; border-top: 1px solid var(--line); margin: 1.25rem 0; }
.desc ul, .desc ol { margin: 0 0 .85rem; padding-left: 1.4rem; }
.desc code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em;
             background: var(--card); border: 1px solid var(--line);
             border-radius: 4px; padding: .05rem .3rem; }
.desc pre { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
            padding: .8rem 1rem; overflow-x: auto; margin: 0 0 .85rem; }
.desc pre code { background: none; border: 0; padding: 0; font-size: .85rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
        padding: .85rem 1rem; margin-bottom: .5rem; }
.card.done { opacity: .72; }
.tid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem;
       color: var(--muted); margin-right: .5rem; }
a.tid:hover { color: var(--accent); }
.pill { display: inline-block; font-size: .72rem; padding: .1rem .5rem; border-radius: 999px;
        border: 1px solid var(--line); color: var(--muted); margin-left: .5rem; vertical-align: 1px; }
.pill.done { color: var(--done); border-color: currentColor; }
.meta { font-size: .85rem; color: var(--muted); margin-top: .4rem; }
.meta ul { margin: .25rem 0 0; padding-left: 1.1rem; }
.row { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; }
.empty { color: var(--muted); font-style: italic; }
footer { max-width: 52rem; margin: 3rem auto 0; color: var(--muted); font-size: .8rem;
         border-top: 1px solid var(--line); padding-top: 1rem; }
details.edit { margin: 0 0 1.5rem; }
details.edit summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
details.edit form { display: flex; flex-direction: column; gap: .75rem; margin-top: .85rem;
                    background: var(--card); border: 1px solid var(--line);
                    border-radius: 10px; padding: 1rem; }
details.edit label { display: flex; flex-direction: column; gap: .3rem; font-size: .8rem;
                     text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
details.edit input, details.edit textarea {
  font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line);
  border-radius: 6px; padding: .5rem .6rem; text-transform: none; letter-spacing: normal;
}
details.edit textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                        font-size: .85rem; }
details.edit button { align-self: flex-start; font: inherit; cursor: pointer; padding: .4rem 1.1rem;
                      border-radius: 6px; border: 1px solid var(--accent);
                      background: var(--accent); color: #fff; }
details.edit .hint { font-size: .78rem; color: var(--muted); }
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

// In a route document a tack is an anchor you can link *to*; in a group
// document it has to be a link *out*, because several routes render into one
// page and every one of them would otherwise claim `id="t1"`. Linking to the
// route's own anchor gives each tack one canonical address either way.
function tackCard(t: Tack, opts: { href?: string } = {}): string {
  const done = t.status === "done";
  const meta: string[] = [];
  if (t.deliverable) meta.push(`deliverable: ${link(t.deliverable.label, t.deliverable.url)}`);
  if (t.depends_on?.length) meta.push(`depends on ${esc(t.depends_on.join(", "))}`);
  for (const l of t.links ?? []) meta.push(link(l.label, l.url));

  const id = opts.href
    ? `<a class="tid" href="${opts.href}">${esc(t.id)}</a>`
    : `<span class="tid">${esc(t.id)}</span>`;

  return `<div class="card${done ? " done" : ""}"${opts.href ? "" : ` id="${esc(t.id)}"`}>
  <div class="row"><div>${id}${esc(t.summary)}</div>
  <span class="pill${done ? " done" : ""}">${esc(t.status)}</span></div>
  ${meta.length ? `<div class="meta">${meta.join(" &middot; ")}</div>` : ""}
  ${todoList(t.before, "before")}${todoList(t.after, "after")}
</div>`;
}

// A plain form, posting to the server, with no script behind it: the page has
// to keep working when the CSP is strict and when JavaScript is off, and a
// fetch()-driven editor would buy nothing here that a 303 doesn't.
//
// Folded shut by default (`<details>`) because reading is what these documents
// are for; the editor is a thing you go looking for.
function editForm(r: Route): string {
  return `<details class="edit"><summary>Edit title and description</summary>
  <form method="post" action="/route/${esc(r.slug)}/edit">
    <label>Title<input name="title" value="${esc(r.title ?? "")}" placeholder="(none)"></label>
    <label>Description<textarea name="description" rows="6" placeholder="Markdown, stored verbatim">${esc(
      r.description ?? "",
    )}</textarea></label>
    <button type="submit">Save</button>
    <span class="hint">Empty a field to clear it.</span>
  </form>
</details>`;
}

export function renderRoute(
  r: Route,
  opts: { crumb?: boolean; editable?: boolean; linkTacks?: boolean } = {},
): string {
  const state = route.routeState(r);
  const open = r.tacks.filter(route.isOpen).length;
  const name = opts.linkTacks
    ? `<a href="/route/${esc(r.slug)}">${esc(r.title ?? r.slug)}</a>`
    : esc(r.title ?? r.slug);
  const head = `<div class="row"><h1>${name}</h1>
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
    ? r.tacks
        .map((t) =>
          tackCard(t, opts.linkTacks ? { href: `/route/${esc(r.slug)}#${esc(t.id)}` } : {}),
        )
        .join("")
    : `<p class="empty">No tacks yet.</p>`;

  return `${opts.crumb === false ? "" : `<div class="crumb"><a href="/">all routes</a></div>`}
${head}${r.description ? `<div class="desc">${markdown(r.description)}</div>` : ""}${deps}
${opts.editable === false ? "" : editForm(r)}
<h2>Tacks</h2>${tacks}`;
}

export function renderIndex(routes: Route[], invalid: route.InvalidRoute[] = []): string {
  // A route file the scan could not read is missing from the cards below. The
  // index says so where the reader is, rather than leaving them to notice an
  // absence (issue #49).
  const banner = invalid.length === 0 ? "" : `<div class="card"><div class="row">
      <div><strong>${invalid.length} route file${invalid.length === 1 ? "" : "s"} could not be read</strong>
      and ${invalid.length === 1 ? "is" : "are"} missing from this page: ${
        invalid.map((r) => esc(`${r.slug}.yaml`)).join(", ")
      }. Run <code>tack doctor</code>.</div>
    </div></div>`;

  if (routes.length === 0) {
    return `<h1>tack</h1>${banner}<p class="empty">No routes yet — <code>tack init &lt;slug&gt;</code>.</p>`;
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

  return `<h1>tack</h1><p class="sub">${routes.length} routes</p>${banner}${sections.join("")}`;
}

export function renderGroup(group: string, routes: Route[]): string {
  // No editor in the group view: the form posts to one route, and repeating it
  // per route in a combined document invites saving the wrong one.
  const body = routes
    .map((r) => renderRoute(r, { crumb: false, editable: false, linkTacks: true }))
    .join('<hr style="border:0">');
  return `<div class="crumb"><a href="/">all routes</a></div><h1>${esc(group)}</h1>
    <p class="sub">${routes.length} routes</p>${body}`;
}

// A cross-site form can POST to a loopback server without reading the
// response, so the Host check that guards reads is not enough for a write:
// same-origin is what has to be proven. Browsers attach Origin to a POST, so a
// present-and-foreign Origin is a rejection. An absent one is a non-browser
// client (curl, a script), which was never subject to CSRF in the first place.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // A description is prose, not a payload; anything past a megabyte is a
      // mistake or an attempt to exhaust the process.
      if (body.length > limit) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
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

  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);

  if (req.method === "POST") {
    const editMatch = path.match(/^\/route\/([^/]+)\/edit\/?$/);
    if (!editMatch) return fail(404, `Nothing accepts a POST at ${path}.`);
    if (!sameOrigin(req)) return fail(403, "Cross-origin write refused.");
    void edit(req, res, editMatch[1], json, fail);
    return;
  }

  if (req.method !== "GET") return fail(405, `${req.method} not allowed.`);

  // Read on every request rather than caching: the CLI writes these files
  // behind the server's back, and a stale document that disagrees with
  // `tack status` is worse than no document.
  // One unreadable file used to 500 every page, index included. The scan
  // reports what it skipped instead, and a request for that route still gets
  // the refusal ([SERVE-04]) — the failure is scoped to the document that
  // cannot honestly be rendered (issue #49).
  route.clearInvalidRoutes();
  const routes = route.scanAll();
  const unreadable = route.invalidRoutes();

  if (path === "/") {
    return json
      ? sendJson(res, 200, routes.map(routeJson))
      : send(res, 200, page("tack", renderIndex(routes, unreadable)));
  }

  const routeMatch = path.match(/^\/route\/([^/]+)\/?$/);
  if (routeMatch) {
    const r = routes.find((x) => x.slug === routeMatch[1]);
    if (!r) {
      const bad = unreadable.find((x) => x.slug === routeMatch[1]);
      return bad
        ? fail(500, `Invalid route file ${bad.slug}.yaml:\n${bad.errors.join("\n")}`)
        : fail(404, `No route ${routeMatch[1]}.`);
    }
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

// The one write path. It goes through the same `route.setTitle` /
// `setDescription` the CLI calls, so the page cannot record something the CLI
// would have refused — validation, the `updated_at` bump, and the `created_at`
// floor all still happen in `save()`.
//
// An empty field clears, mirroring the CLI's `--clear`: a reader who empties
// the box means "there is no title", and a second control to express that
// would be a control nobody finds.
async function edit(
  req: IncomingMessage,
  res: ServerResponse,
  slug: string,
  json: boolean,
  fail: (status: number, message: string) => void,
): Promise<void> {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await readBody(req));
  } catch (e) {
    return fail(413, (e as Error).message);
  }

  try {
    if (form.has("title")) {
      const title = form.get("title")!.trim();
      title ? route.setTitle(slug, title) : route.clearTitle(slug);
    }
    if (form.has("description")) {
      const description = form.get("description")!.replace(/\r\n/g, "\n").replace(/\n+$/, "");
      description ? route.setDescription(slug, description) : route.clearDescription(slug);
    }
  } catch (e) {
    return fail(404, (e as Error).message);
  }

  if (json) return sendJson(res, 200, routeJson(route.load(slug)));
  // 303 so a reload of the resulting page is a GET, not a resubmission.
  res.writeHead(303, { location: `/route/${encodeURIComponent(slug)}` });
  res.end();
}

export function serve(port = DEFAULT_PORT): Server {
  return createServer(handle).listen(port, "127.0.0.1");
}
