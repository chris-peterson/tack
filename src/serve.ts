import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createRequire } from "node:module";
import * as route from "./route.js";
import type { Route, Tack } from "./types.js";

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

// Dracula by default, with its light sibling (Alucard) one click away. The
// toolbar toggle writes `data-theme` on <html>; the choice is remembered per
// browser, and a page with no stored choice renders dark.
const STYLE = `
:root, :root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #282a36; --bar: #21222c; --card: #2d2f3d; --line: #44475a;
  --fg: #f8f8f2; --muted: #b6bcd6; --accent: #bd93f9; --link: #cfb0fb; --on-accent: #282a36;
  --pending: #b6bcd6; --progress: #ffb86c; --done: #50fa7b; --blocked: #ff9494; --dropped: #b6bcd6;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #fffbeb; --bar: #f4eed5; --card: #fffdf5; --line: #d9d3bb;
  --fg: #1f1f1f; --muted: #57513a; --accent: #644ac9; --link: #5a3fc0; --on-accent: #fffbeb;
  --pending: #57513a; --progress: #8f420f; --done: #0f6308; --blocked: #b02a1c; --dropped: #57513a;
}
* { box-sizing: border-box; }
html { scroll-padding-top: 4rem; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
}
.mono, code, .tid, .slug { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
main { max-width: 54rem; margin: 0 auto; padding: 2rem 1rem 4rem; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

.bar { position: sticky; top: 0; z-index: 10; background: var(--bar);
       border-bottom: 1px solid var(--line); }
.bar-in { max-width: 54rem; margin: 0 auto; padding: .55rem 1rem;
          display: flex; align-items: center; gap: 1rem; }
.mark { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700;
        color: var(--fg); font-size: 1rem; }
.mark::before { content: ""; display: inline-block; width: .55rem; height: .55rem;
                border-radius: 50%; background: var(--accent); margin-right: .45rem;
                vertical-align: 1px; }
.filters { display: flex; align-items: center; gap: .6rem; min-width: 0; }
/* A filter pill clicks through three states: off, show only these (+), and
   hide these (-). The glyph and the fill carry the state, not color alone. */
/* Each pill wears the color of the status badges it filters, so "Active"
   reads as the same orange as an "in progress" badge and "Done" as the same
   green as a "done" one. */
.fpill { --tone: var(--muted); display: inline-flex; align-items: center; gap: .3rem; font: inherit;
  font-size: .8rem; padding: .15rem .7rem; border: 1px solid currentColor; border-radius: 999px;
  background: none; color: var(--tone); cursor: pointer; white-space: nowrap; }
.fpill[data-filter-state="active"] { --tone: var(--progress); }
.fpill[data-filter-state="done"] { --tone: var(--done); }
.fpill:hover { background: color-mix(in srgb, var(--tone) 12%, transparent); }
.fpill .n { font-variant-numeric: tabular-nums; }
/* The time window is one joined pill: a clock, then the calendar windows.
   The lit window is the filter; clicking it again clears it. */
.since { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px;
  padding: 2px 2px 2px .5rem; gap: 2px; color: var(--muted); }
.since > svg { width: .8rem; height: .8rem; margin-right: .2rem; }
.since button { font: inherit; font-size: .78rem; padding: .08rem .55rem; border: 0; border-radius: 999px;
  background: none; color: var(--muted); cursor: pointer; font-variant-numeric: tabular-nums; }
.since button:hover { color: var(--fg); background: var(--line); }
.since button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); font-weight: 600; }
.since:has(button[aria-pressed="true"]) { border-color: var(--accent); color: var(--accent); }
.fpill .fmark { display: none; width: .7rem; text-align: center; font-weight: 700; }
.fpill[data-mode="only"] { background: var(--tone); border-color: var(--tone); color: var(--bg); font-weight: 600; }
.fpill[data-mode="only"] .fmark::before { content: "+"; }
.fpill[data-mode="hide"] { border-style: dashed; }
.fpill[data-mode="hide"] .label { text-decoration: line-through; }
.fpill[data-mode="hide"] .fmark::before { content: "\\2212"; }
.fpill[data-mode="only"] .fmark, .fpill[data-mode="hide"] .fmark { display: inline-block; }
.save-state { margin-left: auto; font-size: .8rem; color: var(--muted); }
.save-state[data-state="saved"] { color: var(--done); }
.save-state[data-state="failed"] { color: var(--blocked); }
.theme { position: relative; display: inline-flex; padding: 3px; border: 0; border-radius: 999px;
         background: var(--line); cursor: pointer; }
.theme-opt { position: relative; z-index: 1; display: grid; place-items: center;
             width: 26px; height: 26px; color: var(--muted); transition: color .3s; }
.theme-opt svg { width: 14px; height: 14px; }
.theme-knob { position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%;
              background: var(--bg); transition: transform .35s cubic-bezier(.4, 0, .2, 1); }
:root[data-theme="dark"] .theme-knob { transform: translateX(26px); }
:root[data-theme="dark"] .theme-opt.moon { color: var(--accent); }
:root[data-theme="light"] .theme-opt.sun { color: var(--progress); }
@media (prefers-reduced-motion: reduce) { .theme-knob, .theme-opt { transition: none; } }

h1 { font-size: 1.6rem; line-height: 1.25; margin: 0; letter-spacing: -.01em; }
h2 { font-size: 1.05rem; margin: 2.5rem 0 .75rem; font-weight: 600; }
h2 .count { color: var(--muted); font-weight: 400; margin-left: .35rem; }
.crumb { font-size: .85rem; color: var(--muted); margin-bottom: 1.25rem; }
.head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
.ident { display: flex; align-items: center; gap: .25rem; margin: .35rem 0 0;
         color: var(--muted); font-size: .88rem; }
.empty { color: var(--muted); font-style: italic; }
.row { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; }

.facts { display: flex; flex-wrap: wrap; gap: .5rem 2rem; margin: 1rem 0 1.5rem; padding: 0; }
.facts div { display: flex; flex-direction: column; }
.facts dt { font-size: .75rem; color: var(--muted); }
.facts dd { margin: 0; font-size: .92rem; }

.copy, .pin-btn { position: relative; display: inline-grid; place-items: center; width: 1.6rem; height: 1.6rem;
        padding: 0; border: 1px solid transparent; border-radius: 5px; background: none;
        color: var(--muted); cursor: pointer; flex: none; vertical-align: middle; }
.copy:hover, .pin-btn:hover { border-color: var(--line); color: var(--fg); }
.copy svg, .pin-btn svg { width: .9rem; height: .9rem; }
.pin-btn[aria-pressed="true"] { color: var(--accent); }
.pin-btn[aria-pressed="true"] svg { fill: currentColor; }
.copy .ok { display: none; color: var(--done); }
.copy[data-state="copied"] .ok { display: block; }
.copy[data-state="copied"] .ic { display: none; }
.copy[data-state="failed"]::after { position: absolute; left: 50%; bottom: calc(100% + 4px);
        transform: translateX(-50%); white-space: nowrap; font: 600 .72rem/1 ui-sans-serif, system-ui, sans-serif;
        padding: .3rem .45rem; border-radius: 4px; background: var(--fg); color: var(--bg); }
.copy[data-state="failed"]::after { content: "Copy failed"; background: var(--blocked); }

.status { flex: none; font-size: .75rem; padding: .05rem .55rem; border-radius: 999px;
          border: 1px solid currentColor; white-space: nowrap; }
.s-pending { color: var(--pending); }
.s-in_progress, .s-active { color: var(--progress); }
.s-done { color: var(--done); }
.s-blocked { color: var(--blocked); }
.s-dropped { color: var(--dropped); }
.s-unknown { color: var(--muted); }

.desc { margin: 0 0 1.5rem; max-width: 46rem; }
.desc > :first-child { margin-top: 0; }
.desc > :last-child { margin-bottom: 0; }
.desc p { margin: 0 0 .85rem; }
.desc h1, .desc h2, .desc h3, .desc h4, .desc h5, .desc h6 {
  margin: 1.5rem 0 .5rem; color: var(--fg); font-weight: 600; }
.desc h1 { font-size: 1.25rem; }
.desc h2 { font-size: 1.1rem; }
.desc h3, .desc h4, .desc h5, .desc h6 { font-size: 1rem; }
.desc blockquote { margin: 0 0 .85rem; padding-left: .9rem;
                   border-left: 3px solid var(--line); color: var(--muted); }
.desc table { border-collapse: collapse; margin: 0 0 .85rem; font-size: .9rem; }
.desc th, .desc td { border: 1px solid var(--line); padding: .3rem .6rem; text-align: left; }
.desc hr { border: 0; border-top: 1px solid var(--line); margin: 1.25rem 0; }
.desc ul, .desc ol { margin: 0 0 .85rem; padding-left: 1.4rem; }
.desc code { font-size: .88em; background: var(--card); border: 1px solid var(--line);
             border-radius: 4px; padding: .05rem .3rem; }
.desc pre { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
            padding: .8rem 1rem; overflow-x: auto; margin: 0 0 .85rem; }
.desc pre code { background: none; border: 0; padding: 0; font-size: .85rem; }

/* A tack indents under the tacks it waits on, and the elbow draws the edge, so
   the list reads top to bottom in the order the work can land. */
.tree { list-style: none; margin: 0; padding: 0; }
.node { position: relative; padding-left: calc(min(var(--depth, 0), 4) * 1.6rem); margin-bottom: .5rem; }
.node[data-depth]:not([data-depth="0"])::before {
  content: ""; position: absolute; top: -.5rem; height: 1.75rem; width: .9rem;
  left: calc(min(var(--depth), 4) * 1.6rem - 1.1rem);
  border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent);
  border-bottom-left-radius: 8px; opacity: .7; }
/* With a filter hiding some tacks, the indentation would point at cards that
   are not on screen, so the tree lies flat until the filter is cleared. */
.filtering .node { padding-left: 0; }
.filtering .node[data-depth]::before { display: none; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
        padding: .7rem .9rem; }
/* A closed tack sinks into the page: no raised surface, and its deliverable
   drops to the muted color so the open work carries the page's contrast. */
.card.closed { opacity: .85; background: transparent; border-style: dashed; }
.card.closed .landed { border-color: var(--line); }
.card.closed .landed a, .card.closed a.summary { color: var(--muted); }
.card.closed:hover, .card.closed:focus-within { opacity: 1; }
/* The work in flight is what a reader comes back for, so it is the one card
   lifted off the page. */
.card.in_progress { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--card)); }
.card.in_progress .summary { font-weight: 600; }
/* Pinned tacks are the ones the reader marked as theirs to watch: they take
   the emphasis from every other in-progress card, and each one rides in the
   strip under the toolbar on every page. */
.card.pinned { opacity: 1; border-color: var(--accent); border-style: solid;
  box-shadow: 0 0 0 1px var(--accent), inset 4px 0 0 var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, var(--card)); }
.card.pinned .summary { font-weight: 600; }
.card.pinned.closed .landed a, .card.pinned.closed a.summary { color: var(--fg); }
.pinning .card.in_progress:not(.pinned) { border-color: var(--line); box-shadow: none; background: var(--card); }
.pinning .card.in_progress:not(.pinned) .summary { font-weight: 400; }
.pin-strip { border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--accent) 10%, var(--bar)); }
.pin-in { max-width: 54rem; margin: 0 auto; padding: .35rem 1rem;
  display: flex; align-items: flex-start; gap: .6rem; }
.pin-in > svg { flex: none; width: .95rem; height: .95rem; margin-top: .4rem; color: var(--accent); }
/* Pins wrap onto more rows rather than scrolling out of sight; past a third of
   the screen the strip scrolls, so it never buries the page it sits over. */
.pins { flex: 1; display: flex; flex-wrap: wrap; gap: .4rem; min-width: 0;
  max-height: 33vh; overflow-y: auto; }
.pin-clear { flex: none; margin-top: .1rem; padding: .15rem .6rem; border: 1px solid var(--line);
  border-radius: 999px; background: none; font: inherit; font-size: .78rem; color: var(--muted); cursor: pointer; }
.pin-clear:hover { color: var(--fg); border-color: var(--muted); }
dialog.confirm { max-width: 24rem; padding: 1.25rem 1.25rem 1rem; border: 1px solid var(--line);
  border-radius: 10px; background: var(--card); color: var(--fg); }
dialog.confirm::backdrop { background: rgb(0 0 0 / .45); }
dialog.confirm h2 { margin: 0 0 .4rem; font-size: 1.05rem; }
dialog.confirm p { margin: 0 0 1.1rem; color: var(--muted); font-size: .9rem; }
dialog.confirm .actions { display: flex; justify-content: flex-end; gap: .5rem; }
dialog.confirm button { font: inherit; font-size: .88rem; padding: .35rem .9rem; border-radius: 6px;
  cursor: pointer; border: 1px solid var(--line); background: none; color: var(--fg); }
dialog.confirm button[value="clear"] { border-color: var(--accent); background: var(--accent);
  color: var(--on-accent); font-weight: 600; }
.pin { flex: none; display: inline-flex; align-items: center; max-width: 20rem;
  border: 1px solid var(--line); border-radius: 999px; background: var(--card); }
.pin.s-in_progress { border-color: var(--accent); }
.pin:not([hidden]) { animation: pin-drop .16s ease-out; }
@keyframes pin-drop { from { transform: translateY(-3px); opacity: 0; } }
.pin a { display: inline-flex; align-items: baseline; gap: .4rem; min-width: 0;
  padding: .12rem .1rem .12rem .6rem; color: var(--fg); font-size: .82rem; }
.pin a:hover { text-decoration: none; color: var(--link); }
.pin .dot { flex: none; width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; align-self: center; }
.pin .proute { display: inline-block; max-width: 9rem; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; vertical-align: bottom; color: var(--muted); }
.pin .pid { flex: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .76rem; color: var(--accent); }
.pin .psum { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pin button { flex: none; width: 1.4rem; height: 1.4rem; margin-right: .15rem; padding: 0; border: 0;
  border-radius: 50%; background: none; color: var(--muted); font-size: 1rem; line-height: 1; cursor: pointer; }
.pin button:hover { color: var(--fg); background: var(--line); }
@media (prefers-reduced-motion: reduce) { .pin:not([hidden]) { animation: none; } }
.card-head { display: flex; align-items: flex-start; gap: .75rem; justify-content: space-between; }
.card-title { display: flex; align-items: baseline; gap: .15rem .5rem; flex-wrap: wrap; min-width: 0; }
.tid-wrap { display: inline-flex; align-items: center; }
.tid { font-size: .8rem; color: var(--muted); }
a.tid:hover { color: var(--link); }
a.summary { color: var(--fg); }
a.summary:hover { color: var(--link); }
.card.dropped .summary { text-decoration: line-through; }
.card-side { display: flex; align-items: center; gap: .6rem; flex: none; font-size: .78rem;
             color: var(--muted); }
.landed { border-left: 2px solid var(--accent); padding: .1rem 0 .1rem .7rem;
          margin: .55rem 0 0; font-size: .9rem; }
.landed.done { border-color: var(--done); }
.landed .what { color: var(--muted); font-size: .78rem; display: block; }
.refs { font-size: .85rem; color: var(--muted); margin: .55rem 0 0; padding-left: 1.1rem; }
.refs li { margin: .1rem 0; }
.deps { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; margin: .55rem 0 0;
        font-size: .8rem; color: var(--muted); }
.deps .lbl { margin-right: .1rem; }
.deps .lbl:not(:first-child) { margin-left: .6rem; }
.dep { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem;
       padding: 0 .4rem; border-radius: 4px; border: 1px solid currentColor; }
.dep.s-done::before { content: "\\2713\\00a0"; }

.route-card .card-title a { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92rem; }
.route-card .title { color: var(--muted); font-size: .88rem; }
.flight { list-style: none; margin: .55rem 0 0; padding: 0 0 0 .7rem; border-left: 2px solid var(--accent); }
.flight li { display: flex; align-items: baseline; gap: .5rem; margin: .15rem 0; font-size: .88rem; }
.flight .fsum { flex: 1; min-width: 0; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.flight .fsum:hover { color: var(--link); }
.flight .status { font-size: .7rem; }
.group-head { display: flex; align-items: center; gap: .25rem; margin: 2.5rem 0 .75rem; }
.group-head h2, .group-head h1 { margin: 0 .1rem 0 0; }
.group-head.page { margin: 0; }
.group-head .bucket { color: var(--muted); }
/* The chevron hangs in the gutter on wide screens, so section names stay on
   the same edge as the cards below them. */
.collapse { flex: none; display: grid; place-items: center; width: 1.4rem; height: 1.4rem; padding: 0;
  border: 0; border-radius: 5px; background: none; color: var(--muted); cursor: pointer; }
.collapse:hover { color: var(--fg); background: var(--line); }
.collapse svg { width: .9rem; height: .9rem; transition: transform .15s ease; }
.collapse[aria-expanded="false"] svg { transform: rotate(-90deg); }
@media (min-width: 60rem) { .collapse { margin-left: -1.65rem; } }
@media (prefers-reduced-motion: reduce) { .collapse svg { transition: none; } }
.group-sec .group-head { margin-top: .25rem; }
.group-sec:not([hidden]) ~ .group-sec .group-head { margin-top: 2.5rem; }

details.edit { margin: 0 0 1.5rem; }
details.edit summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
details.edit form { display: flex; flex-direction: column; gap: .75rem; margin-top: .85rem;
                    background: var(--card); border: 1px solid var(--line);
                    border-radius: 8px; padding: 1rem; }
details.edit label { display: flex; flex-direction: column; gap: .3rem; font-size: .85rem;
                     color: var(--muted); }
details.edit input, details.edit textarea {
  font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line);
  border-radius: 6px; padding: .5rem .6rem; }
details.edit textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                        font-size: .85rem; }
details.edit button { align-self: flex-start; font: inherit; cursor: pointer; padding: .4rem 1.1rem;
                      border-radius: 6px; border: 1px solid var(--accent);
                      background: var(--accent); color: var(--on-accent); font-weight: 600; }
details.edit .hint { font-size: .78rem; color: var(--muted); }
.js [data-field] { cursor: text; border-radius: 6px; outline: 1px dashed transparent; outline-offset: 6px; }
.js [data-field]:hover { outline-color: var(--line); }
.js [data-field]:focus, .js [data-field]:focus-within { outline: 1px solid var(--accent); }
h1[data-untitled] { color: var(--muted); }
.desc-editor { display: block; width: 100%; min-height: 6rem; resize: none; overflow: hidden;
  font: .88rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg);
  background: transparent; border: 0; padding: 0; }
.desc-editor:focus-visible { outline: none; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (max-width: 36rem) {
  .head, .card-head { flex-direction: column; gap: .4rem; }
  .node { padding-left: calc(min(var(--depth, 0), 2) * 1.1rem); }
  .node[data-depth]:not([data-depth="0"])::before { left: calc(min(var(--depth), 2) * 1.1rem - .9rem); width: .6rem; }
}
`;

// Runs before first paint so a stored light choice never flashes dark.
const THEME_BOOT = `try{var t=localStorage.getItem("tack-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}document.documentElement.classList.add("js")`;

// Copy and theme controls are rendered `hidden` and revealed here, so a page
// with script off shows no control that cannot work. A failed clipboard write
// is shown on the button, never swallowed.
const SCRIPT = `
(function () {
  var live = document.getElementById("live");
  function flash(b, state, msg) {
    b.dataset.state = state;
    live.textContent = msg;
    clearTimeout(b._t);
    b._t = setTimeout(function () { delete b.dataset.state; }, 1400);
  }
  document.querySelectorAll("button.copy").forEach(function (b) {
    b.hidden = false;
    b.addEventListener("click", function () {
      navigator.clipboard.writeText(b.dataset.copy).then(
        function () { flash(b, "copied", "Copied " + b.dataset.copy); },
        function (e) { console.error("tack: copy failed", e); flash(b, "failed", "Copy failed: " + e.message); }
      );
    });
  });
  var root = document.documentElement;
  var themeSwitch = document.querySelector(".theme");
  function sync() { themeSwitch.setAttribute("aria-checked", String(root.dataset.theme === "dark")); }
  themeSwitch.addEventListener("click", function () {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("tack-theme", root.dataset.theme); } catch (e) {}
    sync();
  });
  themeSwitch.hidden = false;
  sync();

  // Inline editing of a route's title and description. Each field saves a
  // moment after typing stops and again when it loses focus, through the same
  // POST the no-script form uses; a failed save stays on screen in the toolbar.
  var saveState = document.getElementById("save-state");
  var saveTimer = null;
  function report(kind, text) {
    clearTimeout(saveTimer);
    saveState.dataset.state = kind;
    saveState.textContent = text;
    if (kind === "saved") saveTimer = setTimeout(function () { saveState.textContent = ""; delete saveState.dataset.state; }, 2000);
  }
  // One queue per field, so saves land in the order they were made and a value
  // already on disk is not sent twice.
  function saver(el, read, initial) {
    var sent = initial, timer = null, chain = Promise.resolve();
    function now() {
      clearTimeout(timer);
      var next = chain.then(function () {
        var value = read();
        if (value === sent) return;
        report("saving", "Saving " + el.dataset.field + "…");
        var body = new URLSearchParams();
        body.set(el.dataset.field, value);
        return fetch(el.dataset.action, { method: "POST", headers: { accept: "application/json" }, body: body, keepalive: true })
          .then(function (res) {
            return res.json().then(function (j) {
              if (!res.ok) throw new Error(j.error || "HTTP " + res.status);
              sent = value;
              report("saved", "Saved " + el.dataset.field);
            });
          });
      });
      chain = next.catch(function (e) {
        console.error("tack: save failed", e);
        report("failed", "Couldn't save " + el.dataset.field + ": " + e.message);
      });
      return next;
    }
    return { now: now, soon: function () { clearTimeout(timer); timer = setTimeout(now, 1200); } };
  }

  var title = document.querySelector('h1[data-field="title"]');
  if (title) {
    var t = saver(title, function () { return title.textContent.replace(/\\s+/g, " ").trim(); },
      title.hasAttribute("data-untitled") ? "" : title.textContent.trim());
    title.contentEditable = "plaintext-only";
    title.title = "Click to edit the title";
    title.addEventListener("focus", function () { if (title.hasAttribute("data-untitled")) title.textContent = ""; });
    title.addEventListener("input", t.soon);
    title.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); title.blur(); }
    });
    title.addEventListener("blur", function () {
      t.now().then(function () {
        var empty = title.textContent.trim() === "";
        title.toggleAttribute("data-untitled", empty);
        if (empty) title.textContent = title.dataset.slug;
      }, function () {});
    });
  }

  // Pins are the tacks and routes the reader marked to keep an eye on. The pin
  // button on each one toggles it, and every pin shows in the strip under the
  // toolbar on every page. They live in this browser's storage: a pin is a
  // reading preference, not a fact about the route, so it never reaches the
  // route file.
  var PINS_KEY = "tack-pins";
  var strip = document.getElementById("pin-strip");
  var pinList = strip.querySelector(".pins");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pins = [];
  try { pins = JSON.parse(localStorage.getItem(PINS_KEY) || "[]"); } catch (e) { console.warn("tack: pins unreadable, starting empty", e); }
  function savePins() {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)); }
    catch (e) { console.warn("tack: pins will not survive a reload", e); }
  }
  var buttons = document.querySelectorAll(".pin-btn");
  function snapshot(b) { return { key: b.dataset.pin, summary: b.dataset.label, status: b.dataset.status }; }
  // A button on this page is the freshest word on its pin's label and status.
  var fresh = {};
  buttons.forEach(function (b) { fresh[b.dataset.pin] = snapshot(b); });
  pins = pins.map(function (p) { return fresh[p.key] || p; });
  var here = (location.pathname.match(/^\\/route\\/([^/]+)/) || [])[1];
  function isTack(key) { return key.indexOf("/") >= 0; }
  function renderPins() {
    var on = {};
    pins.forEach(function (p) { on[p.key] = true; });
    buttons.forEach(function (b) {
      var pressed = !!on[b.dataset.pin];
      b.hidden = false;
      b.setAttribute("aria-pressed", String(pressed));
      b.setAttribute("aria-label", (pressed ? "Unpin " : "Pin ") + b.dataset.pin);
      b.title = (pressed ? "Unpin " : "Pin ") + b.dataset.pin;
      var card = b.closest(".card");
      if (card) card.classList.toggle("pinned", pressed);
    });
    document.body.classList.toggle("pinning", pins.some(function (p) { return isTack(p.key); }));
    strip.hidden = pins.length === 0;
    pinList.replaceChildren.apply(pinList, pins.map(function (p) {
      var slash = p.key.lastIndexOf("/");
      var slug = slash >= 0 ? p.key.slice(0, slash) : p.key;
      var chip = document.createElement("span");
      chip.className = "pin";
      var a = document.createElement("a");
      a.href = "/route/" + p.key;
      a.title = p.key + ": " + p.summary + " (" + p.status.replace(/_/g, " ") + ")";
      var dot = document.createElement("span"); dot.className = "dot s-" + p.status;
      var id = document.createElement("span"); id.className = "pid";
      if (slash >= 0 && slug !== here) {
        var r = document.createElement("span"); r.className = "proute"; r.textContent = slug + "/";
        id.append(r);
      }
      id.append(slash >= 0 ? p.key.slice(slash + 1) : slug);
      a.append(dot, id);
      if (p.summary !== p.key) {
        var sum = document.createElement("span"); sum.className = "psum"; sum.textContent = p.summary;
        a.append(sum);
      }
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        var target = isTack(p.key)
          ? document.querySelector('.card[data-key="' + CSS.escape(p.key) + '"]')
          : slug === here ? document.querySelector("main") : null;
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ block: isTack(p.key) ? "center" : "start", behavior: reduceMotion ? "auto" : "smooth" });
      });
      var x = document.createElement("button");
      x.type = "button"; x.textContent = "×";
      x.setAttribute("aria-label", "Unpin " + p.key);
      x.addEventListener("click", function () { toggle(p.key); });
      chip.append(a, x);
      return chip;
    }));
  }
  function toggle(key) {
    var at = pins.findIndex(function (p) { return p.key === key; });
    if (at >= 0) pins.splice(at, 1);
    else pins.push(fresh[key]);
    savePins();
    renderPins();
  }
  buttons.forEach(function (b) { b.addEventListener("click", function () { toggle(b.dataset.pin); }); });
  // Another tab pinning or unpinning shows up here without a reload.
  window.addEventListener("storage", function (e) {
    if (e.key !== PINS_KEY) return;
    try { pins = JSON.parse(e.newValue || "[]"); } catch (err) { console.warn("tack: pins unreadable", err); return; }
    renderPins();
  });
  var clearDialog = document.getElementById("clear-pins");
  strip.querySelector(".pin-clear").addEventListener("click", function () {
    clearDialog.querySelector(".count").textContent =
      "This removes all " + pins.length + " pin" + (pins.length === 1 ? "" : "s") + " in this browser. Your tacks and routes stay as they are.";
    clearDialog.returnValue = "";
    clearDialog.showModal();
  });
  clearDialog.addEventListener("close", function () {
    if (clearDialog.returnValue !== "clear") return;
    pins = [];
    savePins();
    renderPins();
  });
  savePins();
  renderPins();

  // Filters: item state and a time window, on every page that lists things.
  // Each state pill clicks through off, show only, and hide. Every choice is
  // remembered in this browser so it carries from page to page, and the
  // address bar shows it too (\`?active=only&since=week\`); a filter the URL
  // names wins over the remembered one, so a shared link opens as sent.
  var FILTERS_KEY = "tack-filters";
  var filters = document.querySelector(".filters");
  if (filters) {
    var pills = filters.querySelectorAll("[data-filter-state]");
    var noun = filters.dataset.noun;
    var noMatch = document.getElementById("no-match");
    var params = new URLSearchParams(location.search);
    var NEXT = { off: "only", only: "hide", hide: "off" };
    var SAYS = { off: "no filter", only: "showing only these", hide: "hidden" };
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || "{}"); } catch (e) { console.warn("tack: saved filters unreadable", e); }
    var pick = function (k) { return params.has(k) ? params.get(k) : saved[k]; };
    pills.forEach(function (b) {
      var m = pick(b.dataset.filterState);
      b.dataset.mode = m === "only" || m === "hide" ? m : "off";
    });
    var since = filters.querySelector(".since");
    // Calendar windows in the viewer's local time, each running from its
    // start to now. A week starts on Monday, as a working week does.
    var windowStart = function (key) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      if (key === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      if (key === "month") d.setDate(1);
      if (key === "quarter") d.setMonth(d.getMonth() - (d.getMonth() % 3), 1);
      if (key === "year") d.setMonth(0, 1);
      return d.getTime();
    };
    var WINDOWS = { today: 1, week: 1, month: 1, quarter: 1, year: 1 };
    var sinceButtons = since ? since.querySelectorAll("[data-since]") : [];
    var setSince = function (v) {
      since.dataset.value = v;
      sinceButtons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.since === v)); });
    };
    if (since) setSince(WINDOWS[pick("since")] ? pick("since") : "");
    var applyFilters = function () {
      var only = {}, hide = {}, anyOnly = false;
      pills.forEach(function (b) {
        if (b.dataset.mode === "only") { only[b.dataset.filterState] = true; anyOnly = true; }
        if (b.dataset.mode === "hide") hide[b.dataset.filterState] = true;
        var label = b.querySelector(".label").textContent;
        b.setAttribute("aria-label", label + " " + noun + ": " + SAYS[b.dataset.mode] + ". Click to change.");
      });
      var cutoff = since && since.dataset.value ? windowStart(since.dataset.value) : 0;
      var shown = 0;
      document.querySelectorAll("[data-filter-scope]").forEach(function (scope) {
        var visible = 0;
        scope.querySelectorAll("li[data-state]").forEach(function (li) {
          var st = li.dataset.state;
          var ok = (!anyOnly || only[st]) && !hide[st] && (!cutoff || !li.dataset.updated || Date.parse(li.dataset.updated) >= cutoff);
          li.hidden = !ok;
          if (ok) visible++;
        });
        var total = scope.querySelectorAll("li[data-state]").length;
        scope.hidden = total > 0 && visible === 0;
        var count = scope.querySelector(".count");
        if (count) count.textContent = visible;
        shown += visible;
      });
      noMatch.hidden = shown > 0 || !document.querySelector("li[data-state]");
      document.body.classList.toggle("filtering", !!document.querySelector("li[data-state][hidden]"));
      var next = new URLSearchParams();
      pills.forEach(function (b) {
        saved[b.dataset.filterState] = b.dataset.mode;
        if (b.dataset.mode !== "off") next.set(b.dataset.filterState, b.dataset.mode);
      });
      if (since) {
        saved.since = since.dataset.value;
        if (since.dataset.value) next.set("since", since.dataset.value);
      }
      try { localStorage.setItem(FILTERS_KEY, JSON.stringify(saved)); }
      catch (e) { console.warn("tack: filters will not carry to the next page", e); }
      var qs = next.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    };
    pills.forEach(function (b) {
      b.addEventListener("click", function () { b.dataset.mode = NEXT[b.dataset.mode]; applyFilters(); });
    });
    sinceButtons.forEach(function (b) {
      b.addEventListener("click", function () {
        setSince(since.dataset.value === b.dataset.since ? "" : b.dataset.since);
        applyFilters();
      });
    });
    noMatch.querySelector("button").addEventListener("click", function () {
      pills.forEach(function (b) { b.dataset.mode = "off"; });
      if (since) setSince("");
      applyFilters();
    });
    filters.hidden = false;
    applyFilters();
  }

  // Index sections collapse to their heading. Which ones are folded is a
  // per-browser reading preference, remembered by section name.
  var COLLAPSE_KEY = "tack-collapsed";
  var folded = {};
  try { (JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")).forEach(function (k) { folded[k] = true; }); }
  catch (e) { console.warn("tack: collapsed sections unreadable, showing all", e); }
  document.querySelectorAll(".group-sec[data-collapse-key]").forEach(function (sec) {
    var key = sec.dataset.collapseKey;
    var btn = sec.querySelector(".collapse");
    var list = document.getElementById(btn.getAttribute("aria-controls"));
    var name = sec.querySelector("h2").firstChild.textContent;
    var set = function (open) {
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", (open ? "Collapse " : "Expand ") + name);
      btn.title = (open ? "Collapse " : "Expand ") + name;
      list.hidden = !open;
    };
    set(!folded[key]);
    btn.hidden = false;
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") !== "true";
      set(open);
      if (open) delete folded[key]; else folded[key] = true;
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Object.keys(folded))); }
      catch (e) { console.warn("tack: collapsed sections will not survive a reload", e); }
    });
  });

  var desc = document.querySelector('[data-field="description"]');
  if (desc) {
    var editor = null;
    var d = saver(desc, function () { return editor.value.replace(/\\r\\n/g, "\\n").replace(/\\n+$/, ""); }, desc.dataset.source);
    var showEmpty = function () {
      if (!desc.dataset.source) desc.innerHTML = '<p class="empty">Add a description</p>';
    };
    var fit = function () { editor.style.height = "auto"; editor.style.height = editor.scrollHeight + "px"; };
    var open = function () {
      if (editor) return editor.focus();
      editor = document.createElement("textarea");
      editor.className = "desc-editor";
      editor.setAttribute("aria-label", "Description, in markdown");
      editor.placeholder = "Markdown";
      editor.value = desc.dataset.source;
      desc.replaceChildren(editor);
      desc.removeAttribute("tabindex");
      fit();
      editor.focus();
      editor.addEventListener("input", function () { fit(); d.soon(); });
      editor.addEventListener("keydown", function (e) { if (e.key === "Escape") editor.blur(); });
      editor.addEventListener("blur", close);
    };
    // Markdown is rendered on the server, so leaving the editor re-reads this
    // document and swaps in the rendered description and the fresh facts.
    var close = function () {
      d.now()
        .then(function () { return fetch(location.pathname, { headers: { accept: "text/html" } }); })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then(function (html) {
          if (document.activeElement === editor) return;
          var doc = new DOMParser().parseFromString(html, "text/html");
          var fresh = doc.querySelector('[data-field="description"]');
          desc.dataset.source = fresh.dataset.source;
          desc.innerHTML = fresh.innerHTML;
          editor = null;
          desc.tabIndex = 0;
          showEmpty();
          var facts = doc.querySelector(".facts");
          if (facts) document.querySelector(".facts").replaceWith(facts);
        })
        .catch(function (e) {
          console.error("tack: description refresh failed", e);
          report("failed", "Couldn't save description: " + e.message);
        });
    };
    desc.hidden = false;
    desc.tabIndex = 0;
    desc.title = "Click to edit the description";
    showEmpty();
    desc.addEventListener("click", function (e) { if (!e.target.closest("a")) open(); });
    desc.addEventListener("keydown", function (e) { if (e.target === desc && e.key === "Enter") { e.preventDefault(); open(); } });
  }
})();
`;

const COPY_ICON = `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg><svg class="ok" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>`;

const PIN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;

// A pin is a tack (`<slug>/<tack-id>`) or a whole route (`<slug>`). The label
// and status ride on the button so the strip can draw the pin on any page.
function pinButton(key: string, label: string, status: string): string {
  return `<button type="button" class="pin-btn" data-pin="${esc(key)}" data-label="${esc(label)}" data-status="${esc(
    status,
  )}" aria-pressed="false" aria-label="Pin ${esc(key)}" title="Pin ${esc(key)}" hidden>${PIN_ICON}</button>`;
}

function copyButton(value: string): string {
  return `<button type="button" class="copy" data-copy="${esc(value)}" title="Copy ${esc(value)}" aria-label="Copy ${esc(value)}" hidden>${COPY_ICON}</button>`;
}

// `tools` is page-specific toolbar content, such as the index's filters.
function page(title: string, body: string, tools = ""): string {
  return `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><script>${THEME_BOOT}</script><style>${STYLE}</style></head>
<body><header class="bar"><div class="bar-in">
  <a class="mark" href="/" title="Store: ${esc(route.storeRoot())}">tack</a>
  ${tools}<span class="save-state" id="save-state" role="status"></span>
  <button type="button" class="theme" role="switch" aria-checked="true" aria-label="Dark theme" title="Switch between light and Dracula" hidden>
    <span class="theme-knob"></span>
    <span class="theme-opt sun"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></span>
    <span class="theme-opt moon"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>
  </button>
</div>
<div class="pin-strip" id="pin-strip" hidden><div class="pin-in">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Pinned"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
  <div class="pins"></div>
  <button type="button" class="pin-clear">Clear all</button>
</div></div></header>
<dialog class="confirm" id="clear-pins" aria-labelledby="clear-pins-title">
  <form method="dialog">
    <h2 id="clear-pins-title">Unpin everything?</h2>
    <p class="count"></p>
    <div class="actions">
      <button value="cancel" autofocus>Cancel</button>
      <button value="clear">Unpin all</button>
    </div>
  </form>
</dialog>
<main>${body}${
  tools
    ? `<p class="empty" id="no-match" hidden>Nothing matches these filters. <button type="button">Clear filters</button></p>`
    : ""
}</main>
<div id="live" class="sr-only" aria-live="polite"></div>
<script>${SCRIPT}</script>
</body></html>`;
}

// A tack's date is stored as a date or a full timestamp. A bare date is shown
// as that date: rendering it through a timezone would move it a day.
function when(value: string, style: "ago" | "date", now = Date.now()): string {
  const raw = String(value);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return esc(raw);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}),
  });
  const full = dateOnly ? date : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  let text = date;
  if (style === "ago" && !dateOnly) {
    const mins = Math.round((now - d.getTime()) / 60_000);
    if (mins < 1) text = "just now";
    else if (mins < 60) text = `${mins} min ago`;
    else if (mins < 60 * 24) text = `${Math.round(mins / 60)} h ago`;
    else if (mins < 60 * 24 * 14) text = `${Math.round(mins / 1440)} d ago`;
  }
  return `<time datetime="${esc(dateOnly ? raw : d.toISOString())}" title="${esc(full)}">${esc(text)}</time>`;
}

function facts(items: [string, string][]): string {
  return `<dl class="facts">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

function statusBadge(status: string): string {
  return `<span class="status s-${esc(status)}">${esc(status.replace(/_/g, " "))}</span>`;
}

// Every tack the rendered document can see, keyed by its qualified
// `<slug>/<tack-id>`, so a dependency chip can show whether the tack it names
// has landed — across routes, when the document holds more than one.
interface TackGraph {
  tacks: Map<string, Tack>;
  dependents: Map<string, string[]>;
}

function graph(routes: Route[]): TackGraph {
  const tacks = new Map<string, Tack>();
  const dependents = new Map<string, string[]>();
  for (const r of routes) {
    for (const t of r.tacks) {
      tacks.set(`${r.slug}/${t.id}`, t);
      for (const entry of t.depends_on ?? []) {
        const ref = route.parseDepRef(entry, r.slug);
        const key = `${ref.slug}/${ref.tackId}`;
        dependents.set(key, [...(dependents.get(key) ?? []), `${r.slug}/${t.id}`]);
      }
    }
  }
  return { tacks, dependents };
}

// Depth-first, in stored order: each tack is placed after every tack it waits
// on within the same list, and indented one level deeper than the deepest of
// them. A cycle in a hand-edited file stops the walk at the repeat rather than
// recursing forever.
function dependencyOrder<T>(
  items: T[],
  key: (item: T) => string,
  deps: (item: T) => string[],
): { item: T; depth: number }[] {
  const byKey = new Map(items.map((i) => [key(i), i]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const out: { item: T; depth: number }[] = [];

  const visit = (item: T): number => {
    const k = key(item);
    if (depth.has(k)) return depth.get(k)!;
    if (visiting.has(k)) return 0;
    visiting.add(k);
    let d = 0;
    for (const dk of deps(item)) {
      const dep = byKey.get(dk);
      if (dep) d = Math.max(d, visit(dep) + 1);
    }
    depth.set(k, d);
    out.push({ item, depth: d });
    return d;
  };
  items.forEach(visit);
  return out;
}

function depChip(qualified: string, fromSlug: string, g: TackGraph): string {
  const [slug, id] = [qualified.slice(0, qualified.lastIndexOf("/")), qualified.slice(qualified.lastIndexOf("/") + 1)];
  const t = g.tacks.get(qualified);
  const status = t?.status ?? "unknown";
  const label = slug === fromSlug ? id : qualified;
  const title = t ? `${qualified}: ${t.summary} (${status.replace(/_/g, " ")})` : `${qualified} (not in this view)`;
  return `<a class="dep s-${esc(status)}" href="/route/${esc(slug)}/${esc(id)}" title="${esc(title)}">${esc(label)}</a>`;
}

function depsLine(r: Route, t: Tack, g: TackGraph): string {
  const needs = (t.depends_on ?? []).map((entry) => {
    const ref = route.parseDepRef(entry, r.slug);
    return `${ref.slug}/${ref.tackId}`;
  });
  const unblocks = g.dependents.get(`${r.slug}/${t.id}`) ?? [];
  if (!needs.length && !unblocks.length) return "";
  const part = (label: string, keys: string[]) =>
    keys.length ? `<span class="lbl">${label}</span>${keys.map((k) => depChip(k, r.slug, g)).join("")}` : "";
  return `<p class="deps">${part("Needs", needs)}${part("Unblocks", unblocks)}</p>`;
}

// A tack card is an anchor in its route document (`/route/<slug>#t1`, where the
// terminal's links land) and links out to the tack's own document.
function tackCard(r: Route, t: Tack, g: TackGraph): string {
  const closed = !route.isOpen(t);
  const qualified = `${r.slug}/${t.id}`;
  return `<div class="card${closed ? " closed" : ""} ${esc(t.status)}" data-key="${esc(qualified)}" id="${esc(t.id)}">
  <div class="card-head"><div class="card-title">
    <span class="tid-wrap"><a class="tid" href="/route/${esc(r.slug)}/${esc(t.id)}">${esc(t.id)}</a>${copyButton(qualified)}</span>
    <a class="summary" href="/route/${esc(r.slug)}/${esc(t.id)}">${esc(t.summary)}</a></div>
    <div class="card-side">${t.done_at ? when(t.done_at, "ago") : ""}${statusBadge(t.status)}${pinButton(qualified, t.summary, t.status)}</div>
  </div>
  ${landed(t)}${refs(t)}${depsLine(r, t, g)}
</div>`;
}

// What the tack produced, set apart from what it merely points at.
function landed(t: Tack): string {
  if (!t.deliverable) return "";
  return `<p class="landed${t.status === "done" ? " done" : ""}">
    <span class="what">delivered</span>${link(t.deliverable.label, t.deliverable.url)}</p>`;
}

function refs(t: Tack): string {
  const items = (t.links ?? []).map((l) => link(l.label, l.url));
  if (!items.length) return "";
  return `<ul class="refs">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

// With script on, the title and description are edited in place (see SCRIPT).
// This form is the same write for a page with script off, posting to the
// server and answered with a 303.
function editForm(r: Route): string {
  return `<noscript><details class="edit"><summary>Edit title and description</summary>
  <form method="post" action="/route/${esc(r.slug)}/edit">
    <label>Title<input name="title" value="${esc(r.title ?? "")}" placeholder="(none)"></label>
    <label>Description<textarea name="description" rows="6" placeholder="Markdown, stored verbatim">${esc(
      r.description ?? "",
    )}</textarea></label>
    <button type="submit">Save</button>
    <span class="hint">Empty a field to clear it.</span>
  </form>
</details></noscript>`;
}

function openCount(tacks: Tack[]): string {
  const open = tacks.filter(route.isOpen).length;
  if (!tacks.length) return "No tacks";
  return open ? `${open} open of ${tacks.length}` : `${tacks.length} done`;
}

export function renderRoute(
  r: Route,
  opts: { routes?: Route[] } = {},
): string {
  const state = route.routeState(r);
  const g = graph(opts.routes ?? [r]);

  const field = (f: string) => ` data-field="${f}" data-action="/route/${esc(r.slug)}/edit"`;
  const desc = `<div class="desc"${field("description")} data-source="${esc(r.description ?? "")}"${
    r.description ? `>${markdown(r.description)}` : " hidden>"
  }</div>`;

  const head = `<div class="head"><div><h1${field("title")} data-slug="${esc(r.slug)}"${r.title ? "" : " data-untitled"}>${esc(
    r.title ?? r.slug,
  )}</h1>
    <p class="ident"><span class="slug">${esc(r.slug)}</span>${copyButton(r.slug)}${pinButton(r.slug, r.title ?? r.slug, state)}</p></div>
    ${statusBadge(state)}</div>
    ${facts([
      ["Started", when(r.created_at, "date")],
      ["Updated", when(r.updated_at, "ago")],
      ["Tacks", openCount(r.tacks)],
      ...(r.group
        ? ([["Group", `<a href="/group/${esc(r.group)}">${esc(r.group)}</a>`]] as [string, string][])
        : []),
    ])}`;

  const ordered = dependencyOrder(
    r.tacks,
    (t) => t.id,
    (t) => (t.depends_on ?? []).map((e) => route.parseDepRef(e, r.slug)).filter((d) => d.slug === r.slug).map((d) => d.tackId),
  );
  const tacks = ordered.length
    ? `<ol class="tree">${ordered
        .map(
          ({ item, depth }) =>
            `<li class="node" data-state="${route.isOpen(item) ? "active" : "done"}"${
              item.done_at ? ` data-updated="${esc(String(item.done_at))}"` : ""
            } data-depth="${depth}" style="--depth:${depth}">${tackCard(r, item, g)}</li>`,
        )
        .join("")}</ol>`
    : `<p class="empty">No tacks yet.</p>`;

  return `<div class="crumb"><a href="/">All routes</a></div>
${head}${desc}
${editForm(r)}
<section data-filter-scope><h2>Tacks<span class="count">${r.tacks.length}</span></h2>${tacks}</section>`;
}

// One tack, addressable on its own — the unit a CLI line, a nudge, or a link in
// a chat names. The deliverable leads because it is what the tack is for; when
// there isn't one, the page says what would make one.
export function renderTack(r: Route, t: Tack, routes: Route[] = [r]): string {
  const qualified = `${r.slug}/${t.id}`;
  const deliverable = t.deliverable
    ? landed(t)
    : `<p class="empty">Nothing landed yet: <code>tack deliverable ${esc(r.slug)} ${esc(
        t.id,
      )} &lt;url&gt;</code></p>`;

  return `<div class="crumb"><a href="/">All routes</a> / <a href="/route/${esc(r.slug)}">${esc(
    r.title ?? r.slug,
  )}</a></div>
<div class="head"><div><h1>${esc(t.summary)}</h1>
  <p class="ident"><span class="slug">${esc(qualified)}</span>${copyButton(qualified)}${pinButton(qualified, t.summary, t.status)}</p></div>
  ${statusBadge(t.status)}</div>
${facts([
  ["Route", `<a href="/route/${esc(r.slug)}">${esc(r.slug)}</a>`],
  ["Route started", when(r.created_at, "date")],
  ...(t.done_at ? ([["Done", when(t.done_at, "ago")]] as [string, string][]) : []),
])}
${deliverable}
${refs(t) || `<p class="empty">No references.</p>`}
${depsLine(r, t, graph(routes))}`;
}

function routeCard(r: Route, body = ""): string {
  const state = route.routeState(r);
  return `<li class="node" data-state="${state}" data-updated="${esc(r.updated_at)}"><div class="card route-card${state === "done" ? " closed" : ""}"><div class="card-head">
      <div class="card-title"><span class="tid-wrap"><a href="/route/${esc(r.slug)}">${esc(r.slug)}</a>${copyButton(
        r.slug,
      )}</span>${r.title ? `<span class="title">${esc(r.title)}</span>` : ""}</div>
      <div class="card-side">${when(r.updated_at, "ago")}<span class="status s-${state}">${openCount(r.tacks)}</span>${pinButton(r.slug, r.title ?? r.slug, state)}</div>
    </div>${body}</div></li>`;
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
    return `${banner}<p class="empty">No routes in <code>${esc(
      route.storeRoot(),
    )}</code> yet. Start one with <code>tack init &lt;slug&gt;</code>.</p>`;
  }

  // Grouped first, in group order; ungrouped last, so the reader meets the
  // organized half of their work before the loose ends.
  const groups = new Map<string, Route[]>();
  const loose: Route[] = [];
  for (const r of [...routes].sort((a, b) => a.slug.localeCompare(b.slug))) {
    if (r.group) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
    else loose.push(r);
  }

  const card = (r: Route): string => routeCard(r);

  // `key` names the section for the collapse state the page remembers; the
  // ungrouped bucket takes one no group slug can collide with.
  const section = (key: string, heading: string, extra: string, rs: Route[], i: number) =>
    `<section class="group-sec" data-filter-scope data-collapse-key="${esc(key)}"><div class="group-head">${collapser(heading, `sec-${i}`)}<h2>${
      heading === key ? `<a href="/group/${esc(key)}">${esc(key)}</a>` : `<span class="bucket">${esc(heading)}</span>`
    }<span class="count">${rs.length}</span></h2>${extra}</div><ul class="tree" id="sec-${i}">${rs.map(card).join("")}</ul></section>`;
  const sections = [...groups.keys()].sort().map((g, i) => section(g, g, copyButton(g), groups.get(g)!, i));
  if (loose.length) sections.push(section(" ungrouped", "Ungrouped", "", loose, sections.length));

  return `${banner}${sections.join("")}`;
}

const CHEVRON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;

function collapser(label: string, controls: string): string {
  return `<button type="button" class="collapse" aria-expanded="true" aria-controls="${controls}" aria-label="Collapse ${esc(
    label,
  )}" title="Collapse ${esc(label)}" hidden>${CHEVRON}</button>`;
}

// The filters live in the toolbar, so they stay in reach while the list
// scrolls. Rendered hidden: filtering is done in the page, and a page with
// script off shows everything. The index filters routes, and a route or group
// page filters tacks; the state pills are shared, so a choice made on one
// page holds on the next. The time window is shared the same way: routes are
// matched on when they were last updated, and tacks on when they were done,
// the one time a tack records, so an open tack always shows.
const CLOCK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/></svg>`;

function filterBar(noun: "routes" | "tacks", active: number, total: number): string {
  if (!total) return "";
  const pill = (state: string, label: string, n: number) =>
    `<button type="button" class="fpill" data-filter-state="${state}" data-mode="off"><span class="fmark" aria-hidden="true"></span><span class="label">${label}</span><span class="n">${n}</span></button>`;
  return `<div class="filters" role="group" aria-label="Filter ${noun}" data-noun="${noun}" hidden>${pill(
    "active",
    "Active",
    active,
  )}${pill("done", "Done", total - active)}
    <div class="since" role="group" data-value="" aria-label="${
      noun === "routes" ? "Show routes updated within" : "Show tacks done within; open tacks always show"
    }" title="${noun === "routes" ? "Routes updated within" : "Tacks done within (open tacks always show)"}">${CLOCK}${[
      ["today", "Today", "Today"],
      ["week", "Week", "This week"],
      ["month", "Month", "This month"],
      ["quarter", "Quarter", "This quarter"],
      ["year", "Year", "This year"],
    ]
      .map(
        ([v, label, words]) =>
          `<button type="button" data-since="${v}" aria-pressed="false" aria-label="${words}">${label}</button>`,
      )
      .join("")}</div></div>`;
}

export function indexFilters(routes: Route[]): string {
  return filterBar("routes", routes.filter((r) => route.routeState(r) === "active").length, routes.length);
}

export function tackFilters(tacks: Tack[]): string {
  return filterBar("tacks", tacks.filter(route.isOpen).length, tacks.length);
}

// A group document answers what the index cannot: what is moving across the
// group, and how its routes depend on each other. Each route is one card with
// its tacks in flight and its edges to other routes; the route's own document
// holds the rest.
export function renderGroup(group: string, routes: Route[], all: Route[] = routes): string {
  // Routes that other routes in the group wait on render first, so the page
  // reads in the order the work can land.
  const ordered = dependencyOrder(
    [...routes].sort((a, b) => a.slug.localeCompare(b.slug)),
    (r) => r.slug,
    (r) => r.tacks.flatMap((t) => (t.depends_on ?? []).map((e) => route.parseDepRef(e, r.slug).slug)).filter((s) => s !== r.slug),
  ).map((o) => o.item);

  const g = graph(all);
  const tacks = routes.flatMap((r) => r.tacks);
  const started = routes.map((r) => r.created_at).sort()[0];
  const updated = routes.map((r) => r.updated_at).sort().at(-1)!;

  const body = (r: Route): string => {
    const flight = r.tacks.filter((t) => t.status === "in_progress" || t.status === "blocked");
    const inFlight = flight.length
      ? `<ul class="flight">${flight
          .map(
            (t) =>
              `<li><a class="tid" href="/route/${esc(r.slug)}/${esc(t.id)}">${esc(t.id)}</a><a class="fsum" href="/route/${esc(
                r.slug,
              )}/${esc(t.id)}">${esc(t.summary)}</a>${statusBadge(t.status)}</li>`,
          )
          .join("")}</ul>`
      : "";
    const needs = new Set<string>();
    const unblocks = new Set<string>();
    for (const t of r.tacks) {
      for (const entry of t.depends_on ?? []) {
        const ref = route.parseDepRef(entry, r.slug);
        if (ref.slug !== r.slug) needs.add(`${ref.slug}/${ref.tackId}`);
      }
      for (const dependent of g.dependents.get(`${r.slug}/${t.id}`) ?? []) {
        if (!dependent.startsWith(`${r.slug}/`)) unblocks.add(dependent);
      }
    }
    const part = (label: string, keys: Set<string>) =>
      keys.size ? `<span class="lbl">${label}</span>${[...keys].map((k) => depChip(k, r.slug, g)).join("")}` : "";
    const edges = needs.size || unblocks.size ? `<p class="deps">${part("Needs", needs)}${part("Unblocks", unblocks)}</p>` : "";
    return inFlight + edges;
  };

  return `<div class="crumb"><a href="/">All routes</a></div>
<div class="group-head page"><h1>${esc(group)}</h1>${copyButton(group)}</div>
${facts([
  ["Routes", String(routes.length)],
  ["Tacks", openCount(tacks)],
  ["Started", when(started, "date")],
  ["Updated", when(updated, "ago")],
])}<section data-filter-scope><h2>Routes<span class="count">${routes.length}</span></h2><ul class="tree">${ordered
    .map((r) => routeCard(r, body(r)))
    .join("")}</ul></section>`;
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
      : send(res, 200, page("tack", renderIndex(routes, unreadable), indexFilters(routes)));
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
    return json ? sendJson(res, 200, routeJson(r)) : send(res, 200, page(r.slug, renderRoute(r, { routes }), tackFilters(r.tacks)));
  }

  // A tack's own document. The route stays the root it hangs off, so the
  // address is the `<slug>/t<N>` a CLI line already prints.
  const tackMatch = path.match(/^\/route\/([^/]+)\/(t[0-9]+)\/?$/);
  if (tackMatch) {
    const r = routes.find((x) => x.slug === tackMatch[1]);
    if (!r) {
      // Same refusal the route's own document gives ([SERVE-04]): a reader
      // following a tack link into a route whose file broke is owed the
      // validation errors, not "no such route".
      const bad = unreadable.find((x) => x.slug === tackMatch[1]);
      return bad
        ? fail(500, `Invalid route file ${bad.slug}.yaml:\n${bad.errors.join("\n")}`)
        : fail(404, `No route ${tackMatch[1]}.`);
    }
    const t = r.tacks.find((x) => x.id === tackMatch[2]);
    if (!t) return fail(404, `No tack ${tackMatch[2]} on ${r.slug}.`);
    return json
      ? sendJson(res, 200, t)
      : send(res, 200, page(`${r.slug}/${t.id}`, renderTack(r, t, routes)));
  }

  const groupMatch = path.match(/^\/group\/([^/]+)\/?$/);
  if (groupMatch) {
    const inGroup = routes.filter((x) => x.group === groupMatch[1]);
    if (!inGroup.length) return fail(404, `No group ${groupMatch[1]}.`);
    return json
      ? sendJson(res, 200, inGroup.map(routeJson))
      : send(res, 200, page(groupMatch[1], renderGroup(groupMatch[1], inGroup, routes), indexFilters(inGroup)));
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
