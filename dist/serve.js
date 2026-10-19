import { createServer } from "node:http";
import { createRequire } from "node:module";
import * as route from "./route.js";
import * as stats from "./stats.js";
import { deliverableStats } from "./forge.js";
import { totalTokens, IDLE_GAP_S } from "./usage.js";
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
export function hyperlinkBase(env = process.env, isTty = process.stdout.isTTY) {
    const forced = env.TACK_HYPERLINKS;
    const port = env.TACK_SERVE_PORT ? parseInt(env.TACK_SERVE_PORT, 10) : DEFAULT_PORT;
    const base = `http://127.0.0.1:${Number.isNaN(port) ? DEFAULT_PORT : port}`;
    if (forced === "0")
        return null;
    if (forced === "1")
        return base;
    if (!isTty || env.TERM === "dumb")
        return null;
    const known = ["iTerm.app", "WezTerm", "ghostty", "vscode", "Hyper"];
    if (known.includes(env.TERM_PROGRAM ?? ""))
        return base;
    if ((env.TERM ?? "").includes("kitty"))
        return base;
    // GNOME Terminal and other VTE emulators gained OSC 8 in 0.50.
    if (parseInt(env.VTE_VERSION ?? "0", 10) >= 5000)
        return base;
    return null;
}
// Everything rendered here comes from route files a person hand-edits, so every
// interpolation is escaped. The one exception is a URL, which is escaped *and*
// scheme-checked below: an attribute-escaped `javascript:` href is still live.
function esc(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function safeHref(url) {
    return /^https?:\/\//i.test(url) ? esc(url) : null;
}
function link(label, url) {
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
let md = null;
function markdown(src) {
    if (!md) {
        const require = createRequire(import.meta.url);
        const MarkdownIt = require("markdown-it");
        md = new MarkdownIt({ linkify: true, typographer: false });
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
  --size: #8be9fd;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #fffbeb; --bar: #f4eed5; --card: #fffdf5; --line: #d9d3bb;
  --fg: #1f1f1f; --muted: #57513a; --accent: #644ac9; --link: #5a3fc0; --on-accent: #fffbeb;
  --pending: #57513a; --progress: #8f420f; --done: #0f6308; --blocked: #b02a1c; --dropped: #57513a;
  --size: #036a96;
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
.stats { margin: 0 0 1.5rem; }
.stats .facts { margin: .25rem 0 1rem; }
.stats .tbl { overflow-x: auto; }
.stats table { border-collapse: collapse; width: 100%; font-size: .86rem; }
.stats th, .stats td { padding: .3rem .6rem; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
.stats th { font-size: .75rem; font-weight: 600; color: var(--muted); }
.stats .num { text-align: right; font-variant-numeric: tabular-nums; }
.add { color: var(--done); }
.del { color: var(--blocked); }
.err { color: var(--blocked); }
.htot { display: flex; flex-wrap: wrap; gap: .25rem 1.4rem; margin: .25rem 0 .9rem; font-size: .9rem; color: var(--muted); }
.hstat b { color: var(--fg); font-weight: 600; font-variant-numeric: tabular-nums; }
.heat { display: flex; flex-direction: column; }
.hrow summary, .hhead { display: grid; grid-template-columns: 2.6rem auto minmax(0, 1fr); align-items: center; gap: .8rem; }
.hrow summary { list-style: none; cursor: pointer; padding: .2rem .35rem; border-radius: 6px; }
.hrow summary::-webkit-details-marker { display: none; }
.hrow summary:hover, .hrow[open] summary { background: var(--card); }
.hhead { padding: 0 .35rem .25rem; font-size: .72rem; color: var(--muted); }
.cells { display: grid; grid-template-columns: repeat(4, 2.6rem); gap: 3px; }
.hhead .cells span { text-align: center; }
.hsum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .88rem; color: var(--muted); }
.hrow[open] .hsum { color: var(--fg); }
.hrow .tnums { margin: .35rem 0 .7rem 3.75rem; }
.tnums .htot { margin: 0 0 .3rem; gap: .2rem 1rem; align-items: baseline; font-size: .82rem; }
.tnums .hstat b { font-size: .92rem; }
.hstat b.add { color: var(--done); }
.hstat b.del { color: var(--blocked); }
.hstat[data-tip] { cursor: help; }
.tnote { color: var(--muted); font-size: .8rem; }
.hsortrow { display: inline-flex; align-items: center; gap: .5rem; flex-basis: 100%; }
.sortpill { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; padding: 2px; gap: 2px; }
.sortpill button { font: inherit; font-size: .76rem; padding: .05rem .6rem; border: 0; border-radius: 999px;
  background: none; color: var(--muted); cursor: pointer; }
.sortpill button:hover { color: var(--fg); background: var(--line); }
.sortpill button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); font-weight: 600; }
.sorted .node { padding-left: 0; }
.sorted .node[data-depth]::before { display: none; }
.hc { --tone: var(--accent); --mix: 7%; display: inline-grid; place-items: center; font-size: .72rem; font-weight: 700; line-height: 1; color: var(--fg); cursor: help; width: 2.6rem; height: 1.15rem; border-radius: 3px;
      background-color: color-mix(in srgb, var(--tone) var(--mix), var(--card)); vertical-align: middle; }
.hc[data-l="1"] { --mix: 28%; } .hc[data-l="2"] { --mix: 48%; } .hc[data-l="3"] { --mix: 70%; } .hc[data-l="4"] { --mix: 95%; }
.t-size { --tone: var(--size); } .t-open { --tone: var(--progress); } .t-merged { --tone: var(--done); } .t-closed { --tone: var(--dropped); }
.hc.shared { background-image: repeating-linear-gradient(135deg, transparent 0 3px, var(--bg) 3px 5px); }
/* A corner notch says the cell has a note: a count that leaves sessions out,
   or a forge read that failed. The tooltip says which. */
.hc.partial, .hc.failed { background-image: linear-gradient(225deg, var(--notch) 5px, transparent 5px); }
.hc.partial { --notch: var(--fg); }
.hc.failed { --notch: var(--blocked); }
.hc.t-size[style] { background: linear-gradient(90deg,
  color-mix(in srgb, var(--done) var(--mix), var(--card)) 0 var(--add),
  color-mix(in srgb, var(--blocked) var(--mix), var(--card)) var(--add) 100%); }
.tip { position: fixed; z-index: 50; max-width: 22rem; padding: .4rem .6rem; border: 1px solid var(--line); border-radius: 6px;
  background: var(--bar); color: var(--muted); font-size: .8rem; line-height: 1.45; white-space: pre-line; pointer-events: none;
  box-shadow: 0 4px 14px rgb(0 0 0 / .25); }
.pid .pgroup { margin-right: .35em; }
.tip b { display: block; color: var(--fg); font-weight: 600; }
.hc.na { background: radial-gradient(circle, var(--line) 2px, transparent 2.5px); }
.hkey { display: flex; flex-wrap: wrap; gap: .3rem 1.1rem; align-items: center; margin: .8rem 0 0; font-size: .78rem; color: var(--muted); }
.stats[data-cards] { margin: 1.25rem 0 0; }
section > .hkey { margin: -.35rem 0 .8rem; }
.card-side .cells { grid-template-columns: repeat(4, 1.5rem); gap: 2px; }
.card-side .hc { width: 1.5rem; height: .85rem; font-size: .66rem; }
.more .tnums { margin: .35rem 0 .5rem; }
@media (max-width: 34rem) { .hrow summary, .hhead { grid-template-columns: 2.2rem auto; } .hsum, .hhead > span:last-child { display: none; } .hrow .facts { margin-left: 0; } }

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
.s-draft { color: var(--progress); }
.s-open { color: var(--accent); }
.s-merged, .s-committed { color: var(--done); }
.s-closed { color: var(--dropped); }

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
.pin-in > .pins-link { flex: none; display: inline-grid; place-items: center; margin-top: .3rem; color: var(--accent); }
.pins-link svg { width: .95rem; height: .95rem; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: 1rem; margin-top: 1.25rem; }
.tile { position: relative; display: flex; flex-direction: column; gap: .6rem; padding: 1.1rem 1.2rem 1.2rem; border: 1px solid var(--line);
  border-radius: 10px; background: var(--card); color: var(--fg); min-width: 0; }
/* The whole tile is the target, so the outline follows the pointer anywhere in
   it; a group is a container of targets and only its title reacts. */
.tile:not(.group-tile):hover { border-color: var(--accent); }
.group-tile > a.tile-title:hover { text-decoration: underline; }
a.tile-title { color: var(--fg); }
a.tile-title:hover { text-decoration: none; }
a.tile-title::after { content: ""; position: absolute; inset: 0; border-radius: 10px; }
.tile-head .status { margin-left: auto; }
.group-tile { grid-column: 1 / -1; background: none; border-style: dashed; }
.group-tile > .tiles.inner { margin-top: .2rem; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); }
.group-tile > a.tile-title::after { display: none; }
.group-tile .tile { position: relative; }
.tile-unpin { position: relative; z-index: 1; display: inline-grid; place-items: center; width: 1.6rem; height: 1.6rem; padding: 0;
  border: 1px solid transparent; border-radius: 5px; background: none; color: var(--accent); cursor: pointer; }
.tile-unpin:hover { border-color: var(--line); }
.tile-unpin svg { width: .9rem; height: .9rem; fill: currentColor; }
.tile[hidden], .tiles[hidden] { display: none; }
.tile[data-state="done"] { border-color: color-mix(in srgb, var(--done) 45%, var(--line));
  background: color-mix(in srgb, var(--done) 7%, var(--card)); }
.group-tile[data-state="done"] { background: color-mix(in srgb, var(--done) 4%, transparent); }
.tile.just-landed { border-color: var(--done); box-shadow: 0 0 0 1px var(--done), 0 0 18px color-mix(in srgb, var(--done) 35%, transparent);
  animation: landed-glow 1.6s ease-out 2; }
@keyframes landed-glow { 50% { box-shadow: 0 0 0 2px var(--done), 0 0 28px color-mix(in srgb, var(--done) 55%, transparent); } }
.landed-note { margin: 0; font-size: .82rem; color: var(--done); font-weight: 600; }
@media (prefers-reduced-motion: reduce) { .tile.just-landed { animation: none; } }
.tile.popped { animation: tile-pop .28s ease-out; }
@keyframes tile-pop { from { opacity: 0; transform: translateY(-10px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .tile.popped { animation: none; } }
.tile-popout { color: var(--muted); }
.tile-popout svg { fill: none; }
.tile-popout:hover { color: var(--accent); }
.tile .tstrip i { position: relative; z-index: 1; }
.tile [data-tip] { position: relative; z-index: 1; }
.tile-head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; font-size: .75rem; color: var(--muted); }
.tile-title { font-weight: 600; font-size: 1.05rem; line-height: 1.35; }
.tile-key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; color: var(--muted); overflow-wrap: anywhere; }
.tile p { margin: 0; }
.tile .htot { margin: 0; gap: .2rem 1rem; font-size: .86rem; align-items: baseline; }
.tile .tnote { font-size: .78rem; }
.tstrip { display: flex; flex-wrap: wrap; gap: 3px; }
.tstrip i { display: block; width: .7rem; height: .7rem; border-radius: 2px; background: currentColor; cursor: help; }
.tstrip i.s-pending, .tstrip i.s-dropped { opacity: .45; }
.tstrip .gap { width: .5rem; }
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
/* A route or group key shrinks with an ellipsis; a tack key shortens its
   route prefix instead, so the tack id stays whole. */
.pin .pid:not(:has(.proute)) { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* A tack's summary gives way before its id does. */
.pin .psum { flex: 0 4 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pin button { flex: none; width: 1.4rem; height: 1.4rem; margin-right: .15rem; padding: 0; border: 0;
  border-radius: 50%; background: none; color: var(--muted); font-size: 1rem; line-height: 1; cursor: pointer; }
.pin button:hover { color: var(--fg); background: var(--line); }
.pin .copy { margin-right: 0; }
.pin .copy svg { width: .8rem; height: .8rem; }
/* The strip scrolls, so a label above or below the chip would be clipped;
   the failure reads over the chip's own text instead. */
.pin .copy[data-state="failed"]::after { left: auto; right: calc(100% + 2px); bottom: auto;
  top: 50%; transform: translateY(-50%); }
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
.landed { display: flex; align-items: baseline; gap: .5rem; margin: .45rem 0 0; font-size: .9rem; }
.landed .what { color: var(--muted); font-size: .78rem; }
.refs { font-size: .85rem; color: var(--muted); margin: .55rem 0 0; padding-left: 1.1rem; }
.refs li { margin: .1rem 0; }
.more { margin: .4rem 0 0; font-size: .8rem; color: var(--muted); }
.more summary { cursor: pointer; width: fit-content; }
.more summary:hover { color: var(--fg); }
.more .refs { margin-top: .25rem; }
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
const COPY_ICON = `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg><svg class="ok" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>`;
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
  function wireCopy(b) {
    b.hidden = false;
    b.addEventListener("click", function () {
      navigator.clipboard.writeText(b.dataset.copy).then(
        function () { flash(b, "copied", "Copied " + b.dataset.copy); },
        function (e) { console.error("tack: copy failed", e); flash(b, "failed", "Copy failed: " + e.message); }
      );
    });
  }
  document.querySelectorAll("button.copy").forEach(wireCopy);
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
  var COPY_ICON = ${JSON.stringify(COPY_ICON)};
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
  var refreshPinsPage = function () {};
  function isTack(key) { return key.indexOf("/") >= 0; }
  function groupOf(key) { return key.indexOf("group:") === 0 ? key.slice(6) : null; }
  var hereGroup = (location.pathname.match(/^\\/group\\/([^/]+)/) || [])[1];
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
    refreshPinsPage();
    // The pins page shows every pin as a tile, each with its own unpin, so the
    // strip would only repeat it.
    strip.hidden = pins.length === 0 || !!document.querySelector("section.pins-page");
    pinList.replaceChildren.apply(pinList, pins.map(function (p) {
      var slash = p.key.lastIndexOf("/");
      var slug = slash >= 0 ? p.key.slice(0, slash) : p.key;
      var chip = document.createElement("span");
      chip.className = "pin";
      var a = document.createElement("a");
      var group = groupOf(p.key);
      a.href = group ? "/group/" + group : "/route/" + p.key;
      a.title = p.key + ": " + p.summary + " (" + p.status.replace(/_/g, " ") + ")";
      var dot = document.createElement("span"); dot.className = "dot s-" + p.status;
      var id = document.createElement("span"); id.className = "pid";
      if (slash >= 0 && slug !== here) {
        var r = document.createElement("span"); r.className = "proute"; r.textContent = slug + "/";
        id.append(r);
      }
      if (group) {
        var gl = document.createElement("span"); gl.className = "proute pgroup"; gl.textContent = "group";
        id.append(gl, group);
      } else id.append(slash >= 0 ? p.key.slice(slash + 1) : slug);
      a.append(dot, id);
      if (p.summary !== p.key && !group) {
        var sum = document.createElement("span"); sum.className = "psum"; sum.textContent = p.summary;
        a.append(sum);
      }
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        var target = isTack(p.key)
          ? document.querySelector('.card[data-key="' + CSS.escape(p.key) + '"]')
          : (group ? group === hereGroup : slug === here) ? document.querySelector("main") : null;
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ block: isTack(p.key) ? "center" : "start", behavior: reduceMotion ? "auto" : "smooth" });
      });
      var c = document.createElement("button");
      c.type = "button"; c.className = "copy"; c.dataset.copy = p.key;
      c.title = "Copy " + p.key; c.setAttribute("aria-label", "Copy " + p.key);
      c.innerHTML = COPY_ICON;
      wireCopy(c);
      var x = document.createElement("button");
      x.type = "button"; x.textContent = "×";
      x.setAttribute("aria-label", "Unpin " + p.key);
      x.addEventListener("click", function () { toggle(p.key); });
      chip.append(a, c, x);
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
  // The pins page is the one left open all day, so it re-reads each tile every
  // minute and whenever the tab comes back into view. A tile whose tacks
  // finished or whose changes landed since the last read glows, says what
  // landed, and counts in the tab title until the pointer reaches it.
  var WATCH_MS = 60000;
  var watching = false;
  var unseen = 0;
  var baseTitle = document.title;
  var showUnseen = function () { document.title = unseen ? "\u2713 " + unseen + " \u00b7 " + baseTitle : baseTitle; };
  var startWatching = function () {
    if (watching) return;
    watching = true;
    setInterval(rereadTiles, WATCH_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) rereadTiles(); });
  };
  var rereadTiles = function () {
    if (!pinsSlot) return;
    pinsSlot.querySelectorAll(".tiles > .tile[data-pin-key]").forEach(function (t) {
      if (t.querySelector(":scope > p.empty")) return;
      fetch(pinsSlot.dataset.pinsSrc + "?k=" + encodeURIComponent(t.dataset.pinKey), { headers: { accept: "text/html" } })
        .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.text(); })
        .then(function (html) {
          var fresh = new DOMParser().parseFromString(html, "text/html").querySelector("main section.pins-page .tiles > .tile");
          if (!fresh || !t.isConnected) return;
          var had = {};
          (t.dataset.landed || "").split(" ").forEach(function (k) { if (k) had[k] = true; });
          var landed = (fresh.dataset.landed || "").split(" ").filter(function (k) { return k && !had[k]; });
          var stillGlowing = t.classList.contains("just-landed") ? t.querySelector(".landed-note") : null;
          if (fresh.outerHTML === t.outerHTML.replace(/ just-landed/, "")) return;
          t.replaceWith(fresh);
          rewire(fresh);
          var note = stillGlowing ? stillGlowing.textContent.replace(/^Just landed: /, "").split(", ") : [];
          if (landed.length || note.length) markLanded(fresh, note.concat(landed.map(function (k) {
            return k.indexOf("change:") === 0 ? k.slice(7) : k.slice(k.lastIndexOf("/") + 1);
          })), !stillGlowing);
        })
        .catch(function (e) { console.error("tack: re-reading " + t.dataset.pinKey + " failed", e); });
    });
  };
  var markLanded = function (t, what, counts) {
    t.classList.add("just-landed");
    var note = document.createElement("p");
    note.className = "landed-note";
    note.textContent = "Just landed: " + what.join(", ");
    t.querySelector(".tile-head").after(note);
    if (counts) { unseen++; showUnseen(); }
    t.addEventListener("pointerenter", function seen() {
      t.removeEventListener("pointerenter", seen);
      t.classList.remove("just-landed");
      note.remove();
      unseen = Math.max(0, unseen - 1);
      showUnseen();
    });
  };
  var rewire = function () {};

  // The pins page renders one tile per pin, asking the server for them by key.
  var pinsSlot = document.querySelector("section.pins-page[data-pins-src]");
  var EMPTY_PINS = '<p class="empty">Nothing pinned yet. Use the pin button on a route, a tack, or a group.</p>';
  if (pinsSlot) {
    var asked = null;
    refreshPinsPage = function () {
      var keys = pins.map(function (p) { return p.key; }).join(" ");
      if (keys === asked) return;
      asked = keys;
      if (!pins.length) {
        pinsSlot.innerHTML = EMPTY_PINS;
        return;
      }
      // One request per pin, so each tile lands as soon as its own forge calls
      // do, rather than every tile waiting on the slowest.
      // Tiles that move when one arrives or leaves glide to their new place:
      // note where each one is, change the page, then animate from there.
      var whereTiles = function () {
        var at = new Map();
        grid.querySelectorAll(":scope > .tile").forEach(function (t) { at.set(t, t.getBoundingClientRect()); });
        return at;
      };
      var glide = function (at) {
        if (reduceMotion) return;
        at.forEach(function (was, t) {
          if (!t.isConnected) return;
          var now = t.getBoundingClientRect();
          var dx = was.left - now.left, dy = was.top - now.top;
          if (dx || dy) t.animate([{ transform: "translate(" + dx + "px, " + dy + "px)" }, { transform: "none" }], { duration: 260, easing: "ease-out" });
        });
      };
      var arrive = function (t) {
        if (reduceMotion) return;
        t.classList.remove("popped");
        void t.offsetWidth;
        t.classList.add("popped");
      };
      var wireUnpin = function (b) {
        b.addEventListener("click", function () {
          var tileEl = b.closest(".tile[data-pin-key]");
          var key = tileEl.dataset.pinKey;
          hideTip();
          b.disabled = true;
          var leave = function () {
            var at = whereTiles();
            tileEl.remove();
            // The tiles left are already on screen, so the unpin shouldn't refetch them.
            asked = pins.filter(function (p) { return p.key !== key; }).map(function (p) { return p.key; }).join(" ");
            if (pins.some(function (p) { return p.key === key; })) toggle(key);
            if (!pinsSlot.querySelector(".tile")) { pinsSlot.innerHTML = EMPTY_PINS; return; }
            settle();
            // A route pinned out of its group goes back in, and shows it arriving.
            var back = grid.querySelector('.group-tile .tile[data-route="' + CSS.escape(key) + '"]');
            if (back && !back.hidden) arrive(back);
            glide(at);
          };
          if (reduceMotion) return leave();
          tileEl.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.96)" }], { duration: 180, easing: "ease-in" })
            .finished.then(leave, leave);
        });
      };
      var grid = document.createElement("div");
      grid.className = "tiles";
      // A route pinned on its own and through its group shows once: as its own
      // tile, left out of the group's.
      var settle = function () {
        grid.querySelectorAll(".group-tile").forEach(function (g) {
          var inner = g.querySelector(".tiles.inner");
          if (!inner) return; // still a placeholder; it settles when it loads
          var shown = 0;
          g.querySelectorAll(".tile[data-route]").forEach(function (t) {
            t.hidden = pins.some(function (p) { return p.key === t.dataset.route; });
            if (!t.hidden) shown++;
          });
          inner.hidden = shown === 0;
          g.querySelector(".all-pinned").hidden = shown > 0;
        });
      };
      rewire = function (el) { wireTile(el); settle(); };
      var wireTile = function (el) {
        el.querySelectorAll(".tile-unpin:not(.tile-popout)").forEach(wireUnpin);
        el.querySelectorAll(".tile-popout").forEach(wirePopout);
      };
      var loadTile = function (key) {
        return fetch(pinsSlot.dataset.pinsSrc + "?k=" + encodeURIComponent(key), { headers: { accept: "text/html" } })
          .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.text(); })
          .then(function (html) {
            return new DOMParser().parseFromString(html, "text/html").querySelector("main section.pins-page .tiles > .tile");
          });
      };
      var addTile = function (p) {
        var holder = document.createElement("div");
        holder.className = groupOf(p.key) ? "tile group-tile" : "tile";
        holder.dataset.pinKey = p.key;
        var head = document.createElement("div");
        head.className = "tile-head";
        head.textContent = groupOf(p.key) ? "group" : isTack(p.key) ? "tack" : "route";
        var title = document.createElement("div");
        title.className = "tile-title";
        title.textContent = p.summary || p.key;
        var note = document.createElement("p");
        note.className = "empty";
        note.textContent = "Reading…";
        holder.append(head, title, note);
        grid.append(holder);
        loadTile(p.key)
          .then(function (fresh) {
            if (!holder.isConnected) return;
            holder.replaceWith(fresh);
            wireTile(fresh);
            settle();
          })
          .catch(function (e) {
            console.error("tack: pin " + p.key + " failed", e);
            note.className = "err";
            note.textContent = "Couldn't read this pin: " + e.message;
          });
      };
      // Pinning a route inside a group pops it out onto its own tile, placed
      // just above the group (and kept there in the pin order). The group then
      // leaves it out until that tile is unpinned.
      var wirePopout = function (b) {
        b.addEventListener("click", function () {
          var p = snapshot(b);
          var group = b.closest(".group-tile");
          hideTip();
          if (pins.some(function (q) { return q.key === p.key; })) return;
          b.disabled = true;
          loadTile(p.key).then(function (fresh) {
            var at = pins.findIndex(function (q) { return q.key === group.dataset.pinKey; });
            var next = pins.slice();
            next.splice(at < 0 ? next.length : at, 0, p);
            asked = next.map(function (q) { return q.key; }).join(" ");
            pins = next;
            savePins();
            renderPins();
            var at = whereTiles();
            group.before(fresh);
            wireTile(fresh);
            settle();
            b.disabled = false;
            arrive(fresh);
            glide(at);
          }, function (e) {
            b.disabled = false;
            console.error("tack: pin " + p.key + " failed", e);
          });
        });
      };
      pins.forEach(addTile);
      startWatching();
      pinsSlot.replaceChildren(grid);
    };
  }
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

  // A stats slot is filled from its own document, which the server renders. On
  // a route page each tack's row of cells moves onto its card and the row's
  // numbers into the card's fold, so a tack's stats sit with the tack.
  function enrichCards(slot, fresh) {
    var slug = slot.dataset.cards;
    var key = fresh.querySelector(".hkey");
    var tacksHead = document.querySelector("section[data-filter-scope] > h2");
    if (key && tacksHead) tacksHead.after(key);
    slot.replaceChildren(fresh.querySelector(".rtot"));
    fresh.querySelectorAll("details.hrow[data-tack]").forEach(function (row) {
      var card = document.querySelector('.card[data-key="' + CSS.escape(slug + "/" + row.dataset.tack) + '"]');
      if (!card) return;
      var cells = row.querySelector(".cells");
      var side = card.querySelector(".card-side");
      side.insertBefore(cells, side.querySelector(".pin-btn"));
      var numbers = row.querySelector(".tnums");
      if (!numbers) return;
      var more = card.querySelector("details.more");
      if (!more) {
        more = document.createElement("details");
        more.className = "more";
        more.append(document.createElement("summary"));
        var deps = card.querySelector(".deps");
        if (deps) deps.before(more); else card.append(more);
      }
      var summary = more.querySelector("summary");
      summary.textContent = summary.textContent ? summary.textContent + ", stats" : "Stats";
      summary.after(numbers);
    });
    if (key) addSort(key);
  }

  // Hover cards for anything carrying data-tip: shown the moment the pointer
  // arrives, where the browser's own title waits a second or more. The first
  // line is the name, the rest the detail.
  var tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  var tipFor = null;
  function showTip(el) {
    var lines = el.dataset.tip.split("\\n");
    var head = document.createElement("b");
    head.textContent = lines[0];
    tip.replaceChildren(head, document.createTextNode(lines.slice(1).join("\\n")));
    tip.hidden = false;
    var r = el.getBoundingClientRect();
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
    tipFor = el;
  }
  function hideTip() { tip.hidden = true; tipFor = null; }
  document.addEventListener("pointerover", function (e) {
    var el = e.target.closest && e.target.closest("[data-tip]");
    if (el && el !== tipFor) showTip(el);
    else if (!el && tipFor) hideTip();
  });
  document.addEventListener("focusin", function (e) {
    var el = e.target.closest && e.target.closest("[data-tip]");
    if (el) showTip(el); else if (tipFor) hideTip();
  });
  window.addEventListener("scroll", hideTip, { passive: true });

  // Ordering by a cell puts the route's hotspots first; the dependency order
  // is the default and is always one click back. Remembered in this browser.
  var SORT_KEY = "tack-sort";
  var METRICS = ["tokens", "duration", "size", "age"];
  function addSort(key) {
    var tree = document.querySelector("section[data-filter-scope] > ol.tree");
    if (!tree) return;
    var original = Array.prototype.slice.call(tree.children);
    var group = document.createElement("span");
    group.className = "sortpill";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Order tacks by");
    var buttons = [""].concat(METRICS).map(function (m) {
      var b = document.createElement("button");
      b.type = "button";
      b.dataset.sort = m;
      b.textContent = m || "dependencies";
      group.append(b);
      return b;
    });
    var value = function (li, m) {
      var cell = li.querySelectorAll(".card-side .hc")[METRICS.indexOf(m)];
      return cell && cell.dataset.v ? Number(cell.dataset.v) : -1;
    };
    var apply = function (m) {
      var items = original.slice();
      if (m) items.sort(function (a, b) { return value(b, m) - value(a, m); });
      tree.append.apply(tree, items);
      document.body.classList.toggle("sorted", !!m);
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.sort === m)); });
      try { localStorage.setItem(SORT_KEY, m); } catch (e) { console.warn("tack: sort order will not survive a reload", e); }
    };
    buttons.forEach(function (b) { b.addEventListener("click", function () { apply(b.dataset.sort); }); });
    var row = document.createElement("span");
    row.className = "hsortrow";
    var label = document.createElement("span");
    label.textContent = "Order by";
    row.append(label, group);
    key.prepend(row);
    var saved = "";
    try { saved = localStorage.getItem(SORT_KEY) || ""; } catch (e) { console.warn("tack: saved sort order unreadable", e); }
    apply(METRICS.indexOf(saved) >= 0 ? saved : "");
  }
  document.querySelectorAll("section.stats[data-stats]").forEach(function (slot) {
    fetch(slot.dataset.stats, { headers: { accept: "text/html" } })
      .then(function (res) {
        return res.text().then(function (html) {
          var doc = new DOMParser().parseFromString(html, "text/html");
          if (!res.ok) {
            var why = doc.querySelector("main p");
            throw new Error(why ? why.textContent : "HTTP " + res.status);
          }
          var fresh = doc.querySelector("main section.stats");
          if (!fresh) throw new Error("the stats document has no stats section");
          if (slot.dataset.cards) enrichCards(slot, fresh); else slot.replaceWith(fresh);
        });
      })
      .catch(function (e) {
        console.error("tack: stats failed", e);
        var p = slot.querySelector("p");
        p.className = "err";
        p.textContent = "Couldn't read stats: " + e.message;
      });
  });
})();
`;
const PIN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
// A pin is a tack (`<slug>/<tack-id>`) or a whole route (`<slug>`). The label
// and status ride on the button so the strip can draw the pin on any page.
function pinButton(key, label, status) {
    return `<button type="button" class="pin-btn" data-pin="${esc(key)}" data-label="${esc(label)}" data-status="${esc(status)}" aria-pressed="false" aria-label="Pin ${esc(key)}" title="Pin ${esc(key)}" hidden>${PIN_ICON}</button>`;
}
function copyButton(value) {
    return `<button type="button" class="copy" data-copy="${esc(value)}" title="Copy ${esc(value)}" aria-label="Copy ${esc(value)}" hidden>${COPY_ICON}</button>`;
}
// `tools` is page-specific toolbar content, such as the index's filters.
function page(title, body, tools = "") {
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
  <a class="pins-link" href="/pins" title="Open pins" aria-label="Open pins"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg></a>
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
<main>${body}${tools
        ? `<p class="empty" id="no-match" hidden>Nothing matches these filters. <button type="button">Clear filters</button></p>`
        : ""}</main>
<div id="live" class="sr-only" aria-live="polite"></div>
<script>${SCRIPT}</script>
</body></html>`;
}
// A tack's date is stored as a date or a full timestamp. A bare date is shown
// as that date: rendering it through a timezone would move it a day.
function when(value, style, now = Date.now()) {
    const raw = String(value);
    const d = new Date(raw);
    if (Number.isNaN(d.getTime()))
        return esc(raw);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const date = d.toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}),
    });
    const full = dateOnly ? date : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    let text = date;
    if (style === "ago" && !dateOnly) {
        const mins = Math.round((now - d.getTime()) / 60_000);
        if (mins < 1)
            text = "just now";
        else if (mins < 60)
            text = `${mins} min ago`;
        else if (mins < 60 * 24)
            text = `${Math.round(mins / 60)} h ago`;
        else if (mins < 60 * 24 * 14)
            text = `${Math.round(mins / 1440)} d ago`;
    }
    return `<time datetime="${esc(dateOnly ? raw : d.toISOString())}" title="${esc(full)}">${esc(text)}</time>`;
}
function facts(items) {
    return `<dl class="facts">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}
function statusBadge(status) {
    return `<span class="status s-${esc(status)}">${esc(status.replace(/_/g, " "))}</span>`;
}
function graph(routes) {
    const tacks = new Map();
    const dependents = new Map();
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
function dependencyOrder(items, key, deps) {
    const byKey = new Map(items.map((i) => [key(i), i]));
    const depth = new Map();
    const visiting = new Set();
    const out = [];
    const visit = (item) => {
        const k = key(item);
        if (depth.has(k))
            return depth.get(k);
        if (visiting.has(k))
            return 0;
        visiting.add(k);
        let d = 0;
        for (const dk of deps(item)) {
            const dep = byKey.get(dk);
            if (dep)
                d = Math.max(d, visit(dep) + 1);
        }
        depth.set(k, d);
        out.push({ item, depth: d });
        return d;
    };
    items.forEach(visit);
    return out;
}
function depChip(qualified, fromSlug, g) {
    const [slug, id] = [qualified.slice(0, qualified.lastIndexOf("/")), qualified.slice(qualified.lastIndexOf("/") + 1)];
    const t = g.tacks.get(qualified);
    const status = t?.status ?? "unknown";
    const label = slug === fromSlug ? id : qualified;
    const title = t ? `${qualified}: ${t.summary} (${status.replace(/_/g, " ")})` : `${qualified} (not in this view)`;
    return `<a class="dep s-${esc(status)}" href="/route/${esc(slug)}/${esc(id)}" title="${esc(title)}">${esc(label)}</a>`;
}
function depsLine(r, t, g) {
    const needs = (t.depends_on ?? []).map((entry) => {
        const ref = route.parseDepRef(entry, r.slug);
        return `${ref.slug}/${ref.tackId}`;
    });
    const unblocks = g.dependents.get(`${r.slug}/${t.id}`) ?? [];
    if (!needs.length && !unblocks.length)
        return "";
    const part = (label, keys) => keys.length ? `<span class="lbl">${label}</span>${keys.map((k) => depChip(k, r.slug, g)).join("")}` : "";
    return `<p class="deps">${part("Needs", needs)}${part("Unblocks", unblocks)}</p>`;
}
// A tack card is an anchor in its route document (`/route/<slug>#t1`, where the
// terminal's links land) and links out to the tack's own document.
function tackCard(r, t, g) {
    const closed = !route.isOpen(t);
    const qualified = `${r.slug}/${t.id}`;
    return `<div class="card${closed ? " closed" : ""} ${esc(t.status)}" data-key="${esc(qualified)}" id="${esc(t.id)}">
  <div class="card-head"><div class="card-title">
    <span class="tid-wrap"><a class="tid" href="/route/${esc(r.slug)}/${esc(t.id)}">${esc(t.id)}</a>${copyButton(qualified)}</span>
    <a class="summary" href="/route/${esc(r.slug)}/${esc(t.id)}">${esc(t.summary)}</a></div>
    <div class="card-side">${t.done_at ? when(t.done_at, "ago") : ""}${statusBadge(t.status)}${pinButton(qualified, t.summary, t.status)}</div>
  </div>
  ${landed(t)}${foldedRefs(t)}${depsLine(r, t, g)}
</div>`;
}
// On a card the deliverable stands alone; the links behind it (the pipeline,
// the issue it closes) open on request. The tack's own document lists them.
function foldedRefs(t) {
    const n = t.links?.length ?? 0;
    if (!n)
        return "";
    return `<details class="more"><summary>${n} link${n === 1 ? "" : "s"}</summary>${refs(t)}</details>`;
}
// What the tack produced, set apart from what it merely points at.
function landed(t) {
    if (!t.deliverable)
        return "";
    return `<p class="landed${t.status === "done" ? " done" : ""}">
    <span class="what">delivered</span>${link(t.deliverable.label, t.deliverable.url)}</p>`;
}
function refs(t) {
    const items = (t.links ?? []).map((l) => link(l.label, l.url));
    if (!items.length)
        return "";
    return `<ul class="refs">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}
// With script on, the title and description are edited in place (see SCRIPT).
// This form is the same write for a page with script off, posting to the
// server and answered with a 303.
function editForm(r) {
    return `<noscript><details class="edit"><summary>Edit title and description</summary>
  <form method="post" action="/route/${esc(r.slug)}/edit">
    <label>Title<input name="title" value="${esc(r.title ?? "")}" placeholder="(none)"></label>
    <label>Description<textarea name="description" rows="6" placeholder="Markdown, stored verbatim">${esc(r.description ?? "")}</textarea></label>
    <button type="submit">Save</button>
    <span class="hint">Empty a field to clear it.</span>
  </form>
</details></noscript>`;
}
function openCount(tacks) {
    const open = tacks.filter(route.isOpen).length;
    if (!tacks.length)
        return "No tacks";
    return open ? `${open} open of ${tacks.length}` : `${tacks.length} done`;
}
export function renderRoute(r, opts = {}) {
    const state = route.routeState(r);
    const g = graph(opts.routes ?? [r]);
    const field = (f) => ` data-field="${f}" data-action="/route/${esc(r.slug)}/edit"`;
    const desc = `<div class="desc"${field("description")} data-source="${esc(r.description ?? "")}"${r.description ? `>${markdown(r.description)}` : " hidden>"}</div>`;
    const head = `<div class="head"><div><h1${field("title")} data-slug="${esc(r.slug)}"${r.title ? "" : " data-untitled"}>${esc(r.title ?? r.slug)}</h1>
    <p class="ident"><span class="slug">${esc(r.slug)}</span>${copyButton(r.slug)}${pinButton(r.slug, r.title ?? r.slug, state)}</p></div>
    ${statusBadge(state)}</div>
    ${facts([
        ["Started", when(r.created_at, "date")],
        ["Updated", when(r.updated_at, "ago")],
        ["Tacks", openCount(r.tacks)],
        ...(r.group
            ? [["Group", `<a href="/group/${esc(r.group)}">${esc(r.group)}</a>`]]
            : []),
    ])}`;
    const ordered = dependencyOrder(r.tacks, (t) => t.id, (t) => (t.depends_on ?? []).map((e) => route.parseDepRef(e, r.slug)).filter((d) => d.slug === r.slug).map((d) => d.tackId));
    const tacks = ordered.length
        ? `<ol class="tree">${ordered
            .map(({ item, depth }) => `<li class="node" data-state="${route.isOpen(item) ? "active" : "done"}"${item.done_at ? ` data-updated="${esc(String(item.done_at))}"` : ""} data-depth="${depth}" style="--depth:${depth}">${tackCard(r, item, g)}</li>`)
            .join("")}</ol>`
        : `<p class="empty">No tacks yet.</p>`;
    return `<div class="crumb"><a href="/">All routes</a></div>
${head}${desc}
${editForm(r)}
${statsSlot(`/route/${r.slug}/stats`, r.slug)}
<section data-filter-scope><h2>Tacks<span class="count">${r.tacks.length}</span></h2>${tacks}</section>`;
}
// Stats come from transcripts and forge calls, which take seconds where the
// rest of a document takes milliseconds, so a document carries an empty slot
// and the page fills it from the stats document ([SERVE-18]). On a route page
// the slot keeps only the totals: each tack's row moves into its card.
function statsSlot(src, cardsOf) {
    return cardsOf
        ? `<section class="stats" data-stats="${esc(src)}" data-cards="${esc(cardsOf)}">
  <p class="htot empty">Reading sessions and change requests… <a href="${esc(src)}">open on its own</a></p></section>`
        : `<section class="stats" data-stats="${esc(src)}"><h2>Stats</h2>
  <p class="empty">Reading sessions and change requests… <a href="${esc(src)}">open on its own</a></p></section>`;
}
function dur(seconds) {
    const m = Math.round(seconds / 60);
    if (m < 1)
        return "<1m";
    if (m < 60)
        return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48)
        return `${h}h${String(m % 60).padStart(2, "0")}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}
function tok(n) {
    if (n >= 1e6)
        return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3)
        return `${Math.round(n / 1e3)}k`;
    return String(n);
}
const since = (a, b, now = Date.now()) => ((b ? Date.parse(b) : now) - Date.parse(a)) / 1000;
function tokenBreakdown(t) {
    return `${totalTokens(t).toLocaleString()} tokens: input ${t.input.toLocaleString()} · output ${t.output.toLocaleString()} · cache read ${t.cache_read.toLocaleString()} · cache write ${t.cache_write.toLocaleString()}`;
}
function tokensCell(t) {
    return `<span title="${esc(tokenBreakdown(t))}">${tok(totalTokens(t))}</span>`;
}
function roughDur(seconds) {
    const m = Math.round(seconds / 60);
    if (m < 60)
        return `${m}m`;
    if (m < 48 * 60)
        return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
}
function roughTok(n) {
    if (n >= 1e6)
        return `${Math.round(n / 1e6)}M`;
    if (n >= 1e3)
        return `${Math.round(n / 1e3)}k`;
    return String(n);
}
function addTokens(ts) {
    return ts.reduce((a, t) => ({ input: a.input + t.input, output: a.output + t.output, cache_read: a.cache_read + t.cache_read, cache_write: a.cache_write + t.cache_write }), { input: 0, output: 0, cache_read: 0, cache_write: 0 });
}
function size(c) {
    if (!c.stats)
        return "";
    const s = c.stats;
    return `<span class="add">+${s.additions}</span> <span class="del">−${s.deletions}</span> · ${s.files} file${s.files === 1 ? "" : "s"}`;
}
// How long the change request has been open, or took to land.
function age(c, now = Date.now()) {
    const s = c.stats;
    if (!s)
        return "";
    if (s.kind === "commit")
        return `committed ${new Date(s.committed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    if (s.merged_at)
        return `merged after ${dur(since(s.opened_at, s.merged_at))}`;
    if (s.closed_at)
        return `closed after ${dur(since(s.opened_at, s.closed_at))}`;
    return `open ${dur(since(s.opened_at, undefined, now))}`;
}
function changeState(c) {
    if (!c.stats)
        return `<span class="err">${esc(c.error ?? "unread")}</span>`;
    return statusBadge(c.stats.kind === "commit" ? "committed" : c.stats.state);
}
const ACTIVE_TITLE = `Idle gaps over ${IDLE_GAP_S / 60} minutes are left out`;
// From a session's first transcript record to its last, idle time included.
const spanOf = (u) => since(u.first, u.last);
// One shade per step: a heatmap cell shows where a value sits within this
// route, and its number is one hover or one click away.
const HEAT_STEPS = 4;
function heatLevel(v, max) {
    if (v <= 0 || max <= 0)
        return 0;
    return Math.max(1, Math.ceil((v / max) * HEAT_STEPS));
}
// `tip` is the hover card: the metric's name, then its value, then any note.
// `value` is the raw figure the page sorts cards by; a cell with no value
// sorts last.
function heatCell(tone, lvl, tip, mark, value, style) {
    const text = tip.filter(Boolean).join("\n");
    return `<span class="hc ${tone}${mark ? ` ${mark}` : ""}" data-l="${lvl}"${value === undefined ? "" : ` data-v="${value}"`}${style ? ` style="${style}"` : ""} data-tip="${esc(text)}" aria-label="${esc(text.replace(/\n/g, ". "))}"></span>`;
}
// Claude Code deletes a transcript after `cleanupPeriodDays` (30 by default),
// so an older session's effort can't be counted.
const NO_TRANSCRIPT = "Transcript deleted: Claude Code keeps them 30 days by default (cleanupPeriodDays)";
function changeAge(c, now) {
    const s = c.stats;
    if (!s || s.kind === "commit")
        return null;
    return since(s.opened_at, s.merged_at ?? s.closed_at, now);
}
const AGE_TONE = { draft: "t-open", open: "t-open", merged: "t-merged", closed: "t-closed" };
// Rounded for scanning; the exact figure is on hover.
function stat(value, unit, tip) {
    return `<span class="hstat"${tip ? ` data-tip="${esc(tip)}"` : ""}><b>${value}</b> ${unit}</span>`;
}
// The one-line roll-up a route's stats, a pinned tack and a pinned group all
// lead with. A session counts once however many tacks it drove.
function totalsLine(sessions, changes) {
    const unique = [...new Map(sessions.map((x) => [x.id, x])).values()];
    const read = unique.filter((x) => x.usage);
    const partialTotal = read.length < unique.length ? `, from ${read.length} of ${unique.length} sessions; the others' transcripts are deleted` : "";
    const tokens = addTokens(read.map((x) => x.usage.tokens));
    // A pushed commit has landed as surely as a merged change request.
    const landed = changes.filter((c) => c.stats && (c.stats.kind === "commit" || c.stats.merged_at)).length;
    const unreadList = changes.filter((c) => !c.stats);
    const unread = unreadList.length;
    const unreadTip = `Couldn't read\n${unreadList.map((c) => `${c.label}: ${c.error ?? "unread"}`).join("\n")}`;
    const activeS = read.reduce((a, x) => a + x.usage.active_s, 0);
    const spanS = read.length
        ? (Math.max(...read.map((x) => Date.parse(x.usage.last))) - Math.min(...read.map((x) => Date.parse(x.usage.first)))) / 1000
        : 0;
    return [
        unique.length && !read.length
            ? stat(String(unique.length), unique.length === 1 ? "session" : "sessions") +
                `<span class="tnote" data-tip="${esc(`Duration and tokens unknown\n${NO_TRANSCRIPT}`)}">duration and tokens unknown</span>`
            : unique.length
                ? stat(String(unique.length), unique.length === 1 ? "session" : "sessions") +
                    stat(roughDur(activeS), "duration", `Duration\n${dur(activeS)} of work across a ${dur(spanS)} span${partialTotal}\n${ACTIVE_TITLE}`) +
                    stat(roughTok(totalTokens(tokens)), "tokens", `Tokens\n${tokenBreakdown(tokens)}${partialTotal}`)
                : `<span class="empty">No sessions recorded</span>`,
        changes.length ? stat(`${landed} of ${changes.length}`, changes.length === 1 ? "change landed" : "changes landed") : "",
        unread ? `<span class="err" data-tip="${esc(unreadTip)}">${unread} change${unread === 1 ? "" : "s"} couldn't be read</span>` : "",
    ].filter(Boolean).join("");
}
export function renderRouteStats(r, s, now = Date.now()) {
    const totals = totalsLine(s.sessions, s.tacks.map((t) => t.change).filter((c) => !!c));
    const rows = s.tacks.map((ts) => {
        const t = r.tacks.find((x) => x.id === ts.id);
        const mine = s.sessions.filter((x) => ts.sessions.includes(x.id));
        const us = mine.filter((x) => x.usage).map((x) => x.usage);
        const others = [...new Set(mine.flatMap((x) => [...x.tacks.filter((id) => id !== ts.id), ...x.elsewhere.map((slug) => `${slug}/…`)]))];
        return { ts, t, mine, us, others, tokens: addTokens(us.map((u) => u.tokens)), active: us.reduce((a, u) => a + u.active_s, 0) };
    });
    const max = {
        tokens: Math.max(0, ...rows.map((x) => totalTokens(x.tokens))),
        active: Math.max(0, ...rows.map((x) => x.active)),
        size: Math.max(0, ...rows.map((x) => (x.ts.change?.stats ? x.ts.change.stats.additions + x.ts.change.stats.deletions : 0))),
        age: Math.max(0, ...rows.map((x) => (x.ts.change ? changeAge(x.ts.change, now) ?? 0 : 0))),
    };
    const body = rows.map(({ ts, t, mine, us, others, tokens: tt, active }) => {
        // Effort is unknown when a session that drove the tack left no transcript,
        // and not this tack's alone when a session also drove others.
        // Nothing to shade when no session left a transcript; a notch when only
        // some did, since the shade then undercounts.
        const effortMark = !mine.length || !us.length ? "na" : us.length < mine.length ? "partial" : others.length ? "shared" : undefined;
        const effortLevel = (v, max) => (us.length ? heatLevel(v, max) : 0);
        const sharedNote = others.length ? `, shared with ${others.join(", ")}` : "";
        const partial = us.length < mine.length ? ` from ${us.length} of ${mine.length} sessions; the others' transcripts are deleted` : "";
        const effortTip = (name, value) => !mine.length
            ? [name, "No session recorded"]
            : us.length
                ? [name, `${value}${partial}`, others.length ? `Shared with ${others.join(", ")}` : ""]
                : [name, "Unknown", NO_TRANSCRIPT];
        const tokTip = effortTip("Tokens", `${tok(totalTokens(tt))} (${tok(tt.cache_read)} cache read, ${tok(tt.cache_write)} cache write, ${tok(tt.output)} output)`);
        const actTip = effortTip("Duration", `${dur(active)} of work across a ${dur(us.reduce((a, u) => a + spanOf(u), 0))} span`);
        const c = ts.change;
        const cs = c?.stats;
        const changeMark = !c ? "na" : !cs ? "failed" : undefined;
        const notChange = t.deliverable && !c ? `${t.deliverable.label} is not a change request or commit` : "No change request or commit delivered";
        const sizeTip = ["Lines changed", !c ? notChange : cs ? `+${cs.additions} −${cs.deletions} in ${cs.files} file${cs.files === 1 ? "" : "s"}` : c.error ?? "Unread"];
        const ageV = c ? changeAge(c, now) : null;
        const ageTip = !c
            ? ["Time open", notChange]
            : !cs
                ? ["Time open", c.error ?? "Unread"]
                : cs.kind === "commit"
                    ? ["Time open", `A commit has no review; ${age(c, now)}`]
                    : [cs.merged_at ? "Time to merge" : cs.closed_at ? "Time to close" : "Time open", `${age(c, now)}${cs.state === "draft" ? ", still a draft" : ""}`];
        const lines = cs ? cs.additions + cs.deletions : 0;
        // Green for lines added and red for lines removed, split by their share.
        const split = cs && lines ? `--add:${Math.round((cs.additions / lines) * 100)}%` : undefined;
        const ageMark = cs?.kind === "commit" ? "na" : changeMark;
        const cells = [
            heatCell("t-effort", effortLevel(totalTokens(tt), max.tokens), tokTip, effortMark, us.length ? totalTokens(tt) : undefined),
            heatCell("t-effort", effortLevel(active, max.active), actTip, effortMark, us.length ? Math.round(active) : undefined),
            heatCell("t-size", cs ? heatLevel(lines, max.size) : 0, sizeTip, changeMark, cs ? lines : undefined, split),
            heatCell(cs?.kind === "change_request" ? AGE_TONE[cs.state] : "t-open", ageV === null ? 0 : heatLevel(ageV, max.age), ageTip, ageMark, ageV === null ? undefined : Math.round(ageV)),
        ].join("");
        const fold = [];
        const plural = (n, one) => (n === 1 ? one : `${one}s`);
        if (mine.length) {
            const prompts = us.reduce((a, u) => a + u.prompts, 0);
            fold.push(us.length
                ? `${stat(roughTok(totalTokens(tt)), "tokens", `Tokens\n${tokenBreakdown(tt)}`)}${stat(dur(active), "duration", `Duration\n${dur(active)} of work across a ${dur(us.reduce((a, u) => a + spanOf(u), 0))} span\n${ACTIVE_TITLE}`)}${stat(String(prompts), plural(prompts, "prompt"))}${stat(String(mine.length), plural(mine.length, "session"))}${others.length ? `<span class="tnote">shared with ${esc(others.join(", "))}</span>` : ""}${partial ? `<span class="tnote">${us.length} of ${mine.length} sessions counted</span>` : ""}`
                : `<span class="tnote">Effort unknown: the session's transcript was deleted (Claude Code keeps 30 days)</span>`);
        }
        if (c && cs) {
            const commits = cs.kind === "change_request" ? stat(String(cs.commits), plural(cs.commits, "commit")) : "";
            fold.push(`${changeState(c)}<span class="hstat"><b class="add">+${cs.additions}</b> <b class="del">−${cs.deletions}</b></span>${stat(String(cs.files), plural(cs.files, "file"))}${commits}<span class="tnote">${esc(age(c, now))}</span>`);
        }
        else if (c) {
            fold.push(`<span class="err">${esc(c.error ?? "unread")}</span>`);
        }
        else if (t.deliverable) {
            fold.push(`<span class="tnote">${esc(t.deliverable.label)} is not a change request or commit, so it has no size or merge time</span>`);
        }
        return `<details class="hrow" data-tack="${esc(ts.id)}"><summary><a class="tid" href="/route/${esc(r.slug)}/${esc(ts.id)}">${esc(ts.id)}</a><span class="cells">${cells}</span><span class="hsum">${esc(t.summary)}</span></summary>
      ${fold.length ? `<div class="tnums">${fold.map((l) => `<p class="htot">${l}</p>`).join("")}</div>` : `<p class="empty">Nothing recorded for this tack yet.</p>`}</details>`;
    }).join("");
    const grid = rows.length
        ? `<div class="heat"><div class="hrow hhead" aria-hidden="true"><span></span><span class="cells"><span>tokens</span><span>duration</span><span>size</span><span>age</span></span><span></span></div>${body}</div>
  <p class="hkey"></p>`
        : "";
    return `<section class="stats"><h2>Stats</h2><p class="htot rtot">${totals}</p>${grid}</section>`;
}
export function renderTackStats(r, t, s, now = Date.now()) {
    const ts = s.tacks.find((x) => x.id === t.id);
    const items = [];
    if (ts.change) {
        const c = ts.change;
        items.push([c.stats?.kind === "commit" ? "Commit" : "Change", `${link(c.label, c.url)} ${changeState(c)}`]);
        if (c.stats?.kind === "commit") {
            items.push(["Size", size(c)]);
            items.push(["Committed", when(c.stats.committed_at, "ago", now)]);
        }
        else if (c.stats) {
            items.push(["Size", `${size(c)} · ${c.stats.commits} commit${c.stats.commits === 1 ? "" : "s"}`]);
            items.push(["Opened", when(c.stats.opened_at, "ago", now)]);
            const ended = c.stats.merged_at ?? c.stats.closed_at;
            if (ended)
                items.push([c.stats.merged_at ? "Merged" : "Closed", `${when(ended, "ago", now)} · after ${dur(since(c.stats.opened_at, ended))}`]);
            else
                items.push(["Open for", dur(since(c.stats.opened_at, undefined, now))]);
        }
    }
    const own = s.sessions.filter((x) => ts.sessions.includes(x.id));
    const rows = own
        .map((x) => {
        const u = x.usage;
        const also = [...x.tacks.filter((id) => id !== t.id), ...x.elsewhere.map((slug) => `${slug}/…`)];
        return `<tr><td class="mono" title="${esc(x.id)}">${esc(x.id.slice(0, 8))}</td>${u
            ? `<td>${esc(u.cwd ?? "")}</td><td class="num">${u.prompts}</td><td class="num" title="${esc(ACTIVE_TITLE)}">${dur(u.active_s)}</td>
             <td class="num" title="${esc(u.first)} → ${esc(u.last)}">${dur(since(u.first, u.last))}</td><td class="num">${tokensCell(u.tokens)}</td>`
            : `<td colspan="5" class="tnote">${esc(NO_TRANSCRIPT)}</td>`}<td>${also.length ? esc(also.join(", ")) : ""}</td></tr>`;
    })
        .join("");
    const table = rows
        ? `<div class="tbl"><table><thead><tr><th>Session</th><th>Ran in</th><th class="num">Prompts</th><th class="num">Duration</th><th class="num">Span</th><th class="num">Tokens</th><th>Also drove</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="empty">No session recorded driving this tack.</p>`;
    return `<section class="stats"><h2>Stats</h2>${items.length ? facts(items) : ""}${table}</section>`;
}
// One tack, addressable on its own — the unit a CLI line, a nudge, or a link in
// a chat names. The deliverable leads because it is what the tack is for; when
// there isn't one, the page says what would make one.
export function renderTack(r, t, routes = [r]) {
    const qualified = `${r.slug}/${t.id}`;
    const deliverable = t.deliverable
        ? landed(t)
        : `<p class="empty">Nothing landed yet: <code>tack deliverable ${esc(r.slug)} ${esc(t.id)} &lt;url&gt;</code></p>`;
    return `<div class="crumb"><a href="/">All routes</a> / <a href="/route/${esc(r.slug)}">${esc(r.title ?? r.slug)}</a></div>
<div class="head"><div><h1>${esc(t.summary)}</h1>
  <p class="ident"><span class="slug">${esc(qualified)}</span>${copyButton(qualified)}${pinButton(qualified, t.summary, t.status)}</p></div>
  ${statusBadge(t.status)}</div>
${facts([
        ["Route", `<a href="/route/${esc(r.slug)}">${esc(r.slug)}</a>`],
        ["Route started", when(r.created_at, "date")],
        ...(t.done_at ? [["Done", when(t.done_at, "ago")]] : []),
    ])}
${deliverable}
${refs(t) || `<p class="empty">No references.</p>`}
${depsLine(r, t, graph(routes))}
${statsSlot(`/route/${r.slug}/${t.id}/stats`)}`;
}
function routeCard(r, body = "") {
    const state = route.routeState(r);
    return `<li class="node" data-state="${state}" data-updated="${esc(r.updated_at)}"><div class="card route-card${state === "done" ? " closed" : ""}"><div class="card-head">
      <div class="card-title"><span class="tid-wrap"><a href="/route/${esc(r.slug)}">${esc(r.slug)}</a>${copyButton(r.slug)}</span>${r.title ? `<span class="title">${esc(r.title)}</span>` : ""}</div>
      <div class="card-side">${when(r.updated_at, "ago")}<span class="status s-${state}">${openCount(r.tacks)}</span>${pinButton(r.slug, r.title ?? r.slug, state)}</div>
    </div>${body}</div></li>`;
}
export function renderIndex(routes, invalid = []) {
    // A route file the scan could not read is missing from the cards below. The
    // index says so where the reader is, rather than leaving them to notice an
    // absence (issue #49).
    const banner = invalid.length === 0 ? "" : `<div class="card"><div class="row">
      <div><strong>${invalid.length} route file${invalid.length === 1 ? "" : "s"} could not be read</strong>
      and ${invalid.length === 1 ? "is" : "are"} missing from this page: ${invalid.map((r) => esc(`${r.slug}.yaml`)).join(", ")}. Run <code>tack doctor</code>.</div>
    </div></div>`;
    if (routes.length === 0) {
        return `${banner}<p class="empty">No routes in <code>${esc(route.storeRoot())}</code> yet. Start one with <code>tack init &lt;slug&gt;</code>.</p>`;
    }
    // Grouped first, in group order; ungrouped last, so the reader meets the
    // organized half of their work before the loose ends.
    const groups = new Map();
    const loose = [];
    for (const r of [...routes].sort((a, b) => a.slug.localeCompare(b.slug))) {
        if (r.group)
            groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
        else
            loose.push(r);
    }
    const card = (r) => routeCard(r);
    // `key` names the section for the collapse state the page remembers; the
    // ungrouped bucket takes one no group slug can collide with.
    const section = (key, heading, extra, rs, i) => `<section class="group-sec" data-filter-scope data-collapse-key="${esc(key)}"><div class="group-head">${collapser(heading, `sec-${i}`)}<h2>${heading === key ? `<a href="/group/${esc(key)}">${esc(key)}</a>` : `<span class="bucket">${esc(heading)}</span>`}<span class="count">${rs.length}</span></h2>${extra}</div><ul class="tree" id="sec-${i}">${rs.map(card).join("")}</ul></section>`;
    const sections = [...groups.keys()].sort().map((g, i) => section(g, g, copyButton(g) + groupPin(g, groups.get(g)), groups.get(g), i));
    if (loose.length)
        sections.push(section(" ungrouped", "Ungrouped", "", loose, sections.length));
    return `${banner}${sections.join("")}`;
}
const CHEVRON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;
function collapser(label, controls) {
    return `<button type="button" class="collapse" aria-expanded="true" aria-controls="${controls}" aria-label="Collapse ${esc(label)}" title="Collapse ${esc(label)}" hidden>${CHEVRON}</button>`;
}
// The filters live in the toolbar, so they stay in reach while the list
// scrolls. Rendered hidden: filtering is done in the page, and a page with
// script off shows everything. The index filters routes, and a route or group
// page filters tacks; the state pills are shared, so a choice made on one
// page holds on the next. The time window is shared the same way: routes are
// matched on when they were last updated, and tacks on when they were done,
// the one time a tack records, so an open tack always shows.
const CLOCK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/></svg>`;
function filterBar(noun, active, total) {
    if (!total)
        return "";
    const pill = (state, label, n) => `<button type="button" class="fpill" data-filter-state="${state}" data-mode="off"><span class="fmark" aria-hidden="true"></span><span class="label">${label}</span><span class="n">${n}</span></button>`;
    return `<div class="filters" role="group" aria-label="Filter ${noun}" data-noun="${noun}" hidden>${pill("active", "Active", active)}${pill("done", "Done", total - active)}
    <div class="since" role="group" data-value="" aria-label="${noun === "routes" ? "Show routes updated within" : "Show tacks done within; open tacks always show"}" title="${noun === "routes" ? "Routes updated within" : "Tacks done within (open tacks always show)"}">${CLOCK}${[
        ["today", "Today", "Today"],
        ["week", "Week", "This week"],
        ["month", "Month", "This month"],
        ["quarter", "Quarter", "This quarter"],
        ["year", "Year", "This year"],
    ]
        .map(([v, label, words]) => `<button type="button" data-since="${v}" aria-pressed="false" aria-label="${words}">${label}</button>`)
        .join("")}</div></div>`;
}
export function indexFilters(routes) {
    return filterBar("routes", routes.filter((r) => route.routeState(r) === "active").length, routes.length);
}
export function tackFilters(tacks) {
    return filterBar("tacks", tacks.filter(route.isOpen).length, tacks.length);
}
// A group pins under `group:<name>`: a group and a route can share a name, and
// no slug contains a colon. It reads active while any of its routes is. A group
// of one route offers no pin of its own: pinning it would pin that route.
function groupPin(group, routes) {
    if (routes.length < 2)
        return "";
    const state = routes.some((r) => route.routeState(r) === "active") ? "active" : "done";
    return pinButton(`group:${group}`, group, state);
}
// A group document answers what the index cannot: what is moving across the
// group, and how its routes depend on each other. Each route is one card with
// its tacks in flight and its edges to other routes; the route's own document
// holds the rest.
export function renderGroup(group, routes, all = routes) {
    // Routes that other routes in the group wait on render first, so the page
    // reads in the order the work can land.
    const ordered = dependencyOrder([...routes].sort((a, b) => a.slug.localeCompare(b.slug)), (r) => r.slug, (r) => r.tacks.flatMap((t) => (t.depends_on ?? []).map((e) => route.parseDepRef(e, r.slug).slug)).filter((s) => s !== r.slug)).map((o) => o.item);
    const g = graph(all);
    const tacks = routes.flatMap((r) => r.tacks);
    const started = routes.map((r) => r.created_at).sort()[0];
    const updated = routes.map((r) => r.updated_at).sort().at(-1);
    const body = (r) => {
        const flight = r.tacks.filter((t) => t.status === "in_progress" || t.status === "blocked");
        const inFlight = flight.length
            ? `<ul class="flight">${flight
                .map((t) => `<li><a class="tid" href="/route/${esc(r.slug)}/${esc(t.id)}">${esc(t.id)}</a><a class="fsum" href="/route/${esc(r.slug)}/${esc(t.id)}">${esc(t.summary)}</a>${statusBadge(t.status)}</li>`)
                .join("")}</ul>`
            : "";
        const needs = new Set();
        const unblocks = new Set();
        for (const t of r.tacks) {
            for (const entry of t.depends_on ?? []) {
                const ref = route.parseDepRef(entry, r.slug);
                if (ref.slug !== r.slug)
                    needs.add(`${ref.slug}/${ref.tackId}`);
            }
            for (const dependent of g.dependents.get(`${r.slug}/${t.id}`) ?? []) {
                if (!dependent.startsWith(`${r.slug}/`))
                    unblocks.add(dependent);
            }
        }
        const part = (label, keys) => keys.size ? `<span class="lbl">${label}</span>${[...keys].map((k) => depChip(k, r.slug, g)).join("")}` : "";
        const edges = needs.size || unblocks.size ? `<p class="deps">${part("Needs", needs)}${part("Unblocks", unblocks)}</p>` : "";
        return inFlight + edges;
    };
    return `<div class="crumb"><a href="/">All routes</a></div>
<div class="group-head page"><h1>${esc(group)}</h1>${copyButton(group)}${groupPin(group, routes)}</div>
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
function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin)
        return true;
    try {
        const host = new URL(origin).hostname;
        return host === "127.0.0.1" || host === "localhost" || host === "::1";
    }
    catch {
        return false;
    }
}
function readBody(req, limit = 1_000_000) {
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
function loopbackHost(req) {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
function send(res, status, html) {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
}
function sendJson(res, status, body) {
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
export function prefersJson(accept) {
    if (!accept)
        return false;
    const q = (type, wildcard) => {
        for (const part of accept.split(",")) {
            const [mime, ...params] = part.trim().split(";");
            if (mime.trim() !== type && mime.trim() !== wildcard)
                continue;
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
function routeJson(r) {
    return { ...r, state: route.routeState(r) };
}
export function handle(req, res, opts = {}) {
    const json = prefersJson(req.headers.accept);
    const fail = (status, message) => json
        ? sendJson(res, status, { error: message })
        : send(res, status, page("tack", `<h1>${status}</h1><p>${esc(message)}</p>`));
    if (!loopbackHost(req))
        return fail(403, "Host must be loopback.");
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (req.method === "POST") {
        const editMatch = path.match(/^\/route\/([^/]+)\/edit\/?$/);
        if (!editMatch)
            return fail(404, `Nothing accepts a POST at ${path}.`);
        if (!sameOrigin(req))
            return fail(403, "Cross-origin write refused.");
        void edit(req, res, editMatch[1], json, fail);
        return;
    }
    if (req.method !== "GET")
        return fail(405, `${req.method} not allowed.`);
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
        if (!t)
            return fail(404, `No tack ${tackMatch[2]} on ${r.slug}.`);
        return json
            ? sendJson(res, 200, t)
            : send(res, 200, page(`${r.slug}/${t.id}`, renderTack(r, t, routes)));
    }
    if (path === "/pins") {
        if (json)
            return fail(406, "Pins are kept in the browser; there is no JSON form of them.");
        return send(res, 200, page("pins", renderPinsShell()));
    }
    if (path === "/pins/tiles") {
        const keys = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").getAll("k");
        void renderPinTiles(keys, routes, opts.probe).then((html) => send(res, 200, page("pins", html)), (e) => fail(500, e.message));
        return;
    }
    const statsMatch = path.match(/^\/route\/([^/]+)\/(?:(t[0-9]+)\/)?stats\/?$/);
    if (statsMatch) {
        const r = routes.find((x) => x.slug === statsMatch[1]);
        if (!r)
            return fail(404, `No route ${statsMatch[1]}.`);
        const t = statsMatch[2] ? r.tacks.find((x) => x.id === statsMatch[2]) : undefined;
        if (statsMatch[2] && !t)
            return fail(404, `No tack ${statsMatch[2]} on ${r.slug}.`);
        void sendStats(res, r, t, json, opts, fail);
        return;
    }
    const groupMatch = path.match(/^\/group\/([^/]+)\/?$/);
    if (groupMatch) {
        const inGroup = routes.filter((x) => x.group === groupMatch[1]);
        if (!inGroup.length)
            return fail(404, `No group ${groupMatch[1]}.`);
        return json
            ? sendJson(res, 200, inGroup.map(routeJson))
            : send(res, 200, page(groupMatch[1], renderGroup(groupMatch[1], inGroup, routes), indexFilters(inGroup)));
    }
    fail(404, `No document at ${path}.`);
}
// Pins are kept in the reader's browser ([SERVE-21]), so the pins page sends
// its keys back and the server renders a tile for each, rolling up the same
// stats the route and tack pages show.
function renderPinsShell() {
    return `<div class="crumb"><a href="/">All routes</a></div>
<h1>Pins</h1>
<section class="pins-page" data-pins-src="/pins/tiles"><p class="empty">Reading your pins…</p></section>
<noscript><p class="empty">Pins are kept in this browser, so this page needs script.</p></noscript>`;
}
function statusStrip(tacks) {
    return tacks.map((t) => `<i class="s-${esc(t.status)}" data-tip="${esc(`${t.id}, ${t.status.replace(/_/g, " ")}\n${t.summary}`)}"></i>`).join("");
}
// `landed` names what has finished under the tile: tacks done (`<slug>/<id>`)
// and changes merged or committed (`change:<label>`). The pins page compares it
// between reads to say what just landed.
function tile(href, kind, state, title, key, pin, body, cls = "tile", landed = []) {
    // A pinned tile unpins itself. A route tile inside a pinned group names its
    // route, so the page can leave it out when that route is pinned on its own.
    const unpin = pin
        ? `<button type="button" class="tile-unpin" aria-label="Unpin ${esc(pin)}" data-tip="Unpin\n${esc(pin)}">${PIN_ICON}</button>`
        : kind === "route"
            ? `<button type="button" class="tile-unpin tile-popout" data-pin="${esc(key)}" data-label="${esc(title)}" data-status="${esc(state)}" aria-label="Pin ${esc(key)} on its own" data-tip="Pin\n${esc(key)}\nShows it on its own, outside the group">${PIN_ICON}</button>`
            : "";
    return `<div class="${cls}" data-state="${esc(state)}" data-landed="${esc(landed.join(" "))}"${pin ? ` data-pin-key="${esc(pin)}"` : kind === "route" ? ` data-route="${esc(key)}"` : ""}><div class="tile-head"><span>${kind}</span>${statusBadge(state)}${unpin}</div>
  <a class="tile-title" href="${esc(href)}">${esc(title)}</a>${key === title ? "" : `<div class="tile-key">${esc(key)}</div>`}${body}</div>`;
}
const changesOf = (s) => s.tacks.map((t) => t.change).filter((c) => !!c);
function landedOf(slug, tacks, changes) {
    return [
        ...tacks.filter((t) => t.status === "done").map((t) => `${slug}/${t.id}`),
        ...changes.filter((c) => c.stats && (c.stats.kind === "commit" || c.stats.merged_at)).map((c) => `change:${c.label}`),
    ];
}
function routeTile(r, s, pin) {
    return tile(`/route/${r.slug}`, "route", route.routeState(r), r.title ?? r.slug, r.slug, pin, `<div class="tstrip">${statusStrip(r.tacks)}</div><p class="htot">${totalsLine(s.sessions, changesOf(s))}</p>`, "tile", landedOf(r.slug, r.tacks, changesOf(s)));
}
export async function renderPinTiles(keys, routes, probe, now = Date.now()) {
    const missing = (what) => `<div class="tile" data-pin-key="${esc(what)}"><div class="tile-head"><span>gone</span>
    <button type="button" class="tile-unpin" aria-label="Unpin ${esc(what)}" data-tip="Unpin\n${esc(what)}">${PIN_ICON}</button></div>
    <div class="tile-title">${esc(what)}</div><p class="tnote">Not in the store any more.</p></div>`;
    const tiles = await Promise.all(keys.map(async (key) => {
        if (key.startsWith("group:")) {
            const group = key.slice(6);
            const rs = routes.filter((r) => r.group === group);
            if (!rs.length)
                return missing(key);
            const all = await Promise.all(rs.map((r) => stats.routeStats(r, probe)));
            const state = rs.some((r) => route.routeState(r) === "active") ? "active" : "done";
            // A group is a container: its totals across every route, then a tile
            // per route, each with its own roll-up.
            const inner = rs.map((r, i) => routeTile(r, all[i], "")).join("");
            return tile(`/group/${group}`, "group", state, group, group, key, `<p class="htot">${totalsLine(all.flatMap((s) => s.sessions), all.flatMap(changesOf))}</p><div class="tiles inner">${inner}</div>
          <p class="tnote all-pinned" hidden>Each of its routes is pinned on its own.</p>`, "tile group-tile", rs.flatMap((r, i) => landedOf(r.slug, r.tacks, changesOf(all[i]))));
        }
        const slash = key.lastIndexOf("/");
        const slug = slash >= 0 ? key.slice(0, slash) : key;
        const r = routes.find((x) => x.slug === slug);
        if (!r)
            return missing(key);
        if (slash < 0)
            return routeTile(r, await stats.routeStats(r, probe), key);
        const t = r.tacks.find((x) => x.id === key.slice(slash + 1));
        if (!t)
            return missing(key);
        const s = await stats.routeStats({ ...r, tacks: [t] }, probe);
        const c = s.tacks[0].change;
        const change = c?.stats
            ? `<p class="htot">${changeState(c)}<span class="hstat"><b class="add">+${c.stats.additions}</b> <b class="del">−${c.stats.deletions}</b></span><span class="tnote">${esc(age(c, now))}</span></p>`
            : c
                ? `<p class="err">${esc(c.error ?? "unread")}</p>`
                : t.deliverable
                    ? `<p class="tnote">delivered ${esc(t.deliverable.label)}</p>`
                    : "";
        return tile(`/route/${r.slug}/${t.id}`, "tack", t.status, t.summary, key, key, `${change}<p class="htot">${totalsLine(s.sessions.filter((x) => x.tacks.includes(t.id)), [])}</p>`, "tile", landedOf(r.slug, [t], c ? [c] : []));
    }));
    return `<section class="pins-page"><div class="tiles">${tiles.join("")}</div></section>`;
}
// A tack's stats are its slice of the route's: a session counts toward every
// tack it drove, so the tack document needs the same session list.
async function sendStats(res, r, t, json, opts, fail) {
    let s;
    try {
        s = await stats.routeStats(t ? { ...r, tacks: [t] } : r, opts.probe);
    }
    catch (e) {
        return fail(500, e.message);
    }
    if (json) {
        if (!t)
            return sendJson(res, 200, s);
        return sendJson(res, 200, { tack: s.tacks[0], sessions: s.sessions.filter((x) => x.tacks.includes(t.id)) });
    }
    const crumb = `<div class="crumb"><a href="/">All routes</a> / <a href="/route/${esc(r.slug)}">${esc(r.title ?? r.slug)}</a>${t ? ` / <a href="/route/${esc(r.slug)}/${esc(t.id)}">${esc(t.id)}</a>` : ""}</div>`;
    const body = t ? renderTackStats(r, t, s) : renderRouteStats(r, s);
    send(res, 200, page(`${t ? `${r.slug}/${t.id}` : r.slug} stats`, crumb + body));
}
// The one write path. It goes through the same `route.setTitle` /
// `setDescription` the CLI calls, so the page cannot record something the CLI
// would have refused — validation, the `updated_at` bump, and the `created_at`
// floor all still happen in `save()`.
//
// An empty field clears, mirroring the CLI's `--clear`: a reader who empties
// the box means "there is no title", and a second control to express that
// would be a control nobody finds.
async function edit(req, res, slug, json, fail) {
    let form;
    try {
        form = new URLSearchParams(await readBody(req));
    }
    catch (e) {
        return fail(413, e.message);
    }
    try {
        if (form.has("title")) {
            const title = form.get("title").trim();
            title ? route.setTitle(slug, title) : route.clearTitle(slug);
        }
        if (form.has("description")) {
            const description = form.get("description").replace(/\r\n/g, "\n").replace(/\n+$/, "");
            description ? route.setDescription(slug, description) : route.clearDescription(slug);
        }
    }
    catch (e) {
        return fail(404, e.message);
    }
    if (json)
        return sendJson(res, 200, routeJson(route.load(slug)));
    // 303 so a reload of the resulting page is a GET, not a resubmission.
    res.writeHead(303, { location: `/route/${encodeURIComponent(slug)}` });
    res.end();
}
export function serve(port = DEFAULT_PORT, opts = {}) {
    const probe = stats.cachedProbe(opts.probe ?? deliverableStats);
    return createServer((req, res) => handle(req, res, { ...opts, probe })).listen(port, "127.0.0.1");
}
