import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import { maxLength, validate } from "./schema.js";
import * as repos from "./repos.js";
import * as sessions from "./sessions.js";
import type { Link, Route, Session, Tack, TackStatus } from "./types.js";

const TACK_HOME = process.env.TACK_HOME ?? join(homedir(), ".tack");
const YEAR_DIR = /^\d{4}$/;

// A route file lives under the year it was opened in. Lookups scan every year,
// so one that outlives its year stays in the file it started in rather than
// being split or moved.
function years(): string[] {
  if (!existsSync(TACK_HOME)) return [];
  assertNoFlatLayout();
  return readdirSync(TACK_HOME, { withFileTypes: true })
    .filter((e) => e.isDirectory() && YEAR_DIR.test(e.name))
    .map((e) => e.name)
    .sort();
}

// Through 1.6 every route sat directly in `<root>/routes/`. Nothing reads that
// directory now, so left unmoved it would read as an empty store ([COMPAT-06a]).
function assertNoFlatLayout(): void {
  const flat = join(TACK_HOME, "routes");
  if (!existsSync(flat)) return;
  const n = readdirSync(flat).filter((f) => f.endsWith(".yaml")).length;
  if (n === 0) return;
  const root = storeRoot();
  throw new Error(
    `${root}/routes/ holds ${n} route file${n === 1 ? "" : "s"} in the layout tack used through 1.6. ` +
      `Routes now live in ${root}/<year>/routes/, under the year each was opened (its created_at). ` +
      `Move each file there to load it.`,
  );
}

function yearDir(year: string): string {
  return join(TACK_HOME, year, "routes");
}

// The store this process reads, for a surface that has to tell the reader where
// what they are looking at came from. Abbreviated against `$HOME`, since that
// is how the path is written down everywhere else.
export function storeRoot(): string {
  const home = homedir();
  return TACK_HOME.startsWith(`${home}/`) ? `~${TACK_HOME.slice(home.length)}` : TACK_HOME;
}

export function isOpen(t: Tack): boolean {
  return t.status !== "done" && t.status !== "dropped";
}

// Whether a route is finished is a function of its tacks, never a field of its
// own: it is done when it holds tacks and none of them are open, and adding a
// fresh tack reopens it. Stored, the two would drift the moment a tack landed
// without the route being touched.
//
// An empty route is active — "done" would claim completed work that never
// existed. The word is `state` rather than `status` because a tack's `status`
// is set by the caller and this one cannot be.
export function routeState(route: Route): "active" | "done" {
  if (route.tacks.length === 0) return "active";
  return route.tacks.some(isOpen) ? "active" : "done";
}

// Mirrors the schema's slug pattern. Callers that accept a slug from the user
// check it here so the failure names the rule, instead of surfacing as an ajv
// pattern error from save() after the command already looked like it worked.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export function assertValidSlug(slug: string, what = "slug"): void {
  if (SLUG_PATTERN.test(slug)) return;
  throw new Error(
    `Invalid ${what}: ${slug} (lowercase letters, digits, and inner hyphens only)`,
  );
}

// Mirrors the schema's length limits at the command boundary, for the reason
// assertValidSlug mirrors its slug pattern: refused here, the message names the
// thing the caller typed. Left to save(), the same input surfaces as the ajv
// path `/tacks/0/after/0/text`, which is an array index into a file the caller
// never opened.
//
// The limit is read from the schema ([STORE-04]) rather than restated, and the
// value is measured after the cleaning save() will apply — otherwise text that
// only exceeds the limit in whitespace the write is about to collapse would be
// refused for a length it never gets stored at.
function assertLength(value: string, key: string, what: string): void {
  const limit = maxLength(key);
  if (value.length <= limit) return;
  throw new Error(`${what} is ${value.length} characters; the limit is ${limit}`);
}

function assertLineLength(value: string, key: string, what: string): void {
  assertLength(cleanLine(value), key, what);
}

function assertBlockLength(value: string, key: string, what: string): void {
  assertLength(cleanBlock(value), key, what);
}

// Free text in a route is not always something the user typed. `tack describe
// --file -` is documented as taking an issue body straight off a forge, and the
// start skill drives exactly that, so a description — and a summary derived from
// one — is attacker-authored prose. It then goes two places that read control
// characters as commands rather than as text: a terminal, where an ESC sequence
// repaints the screen, and an agent's context, where a newline in a field
// rendered inline forges the structure around it.
//
// Stripping happens on the way in and out of the file rather than at each of the
// dozen render sites, so display, `--json`, and the web view all get text that is
// safe to print, and a route file that already holds a payload is cleaned when
// it loads.
//
// Tab and newline are legitimate in prose; every other C0 control, DEL, and
// the C1 range are not, and are what a terminal reads as an escape sequence.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const CONTROL_CHARS_AND_BREAKS = /[\u0000-\u001F\u007F-\u009F]+/g;

// Prose that keeps its line structure: newlines and tabs survive, everything
// else in the C0/C1 ranges does not.
function cleanBlock(s: string): string {
  return s.replace(CONTROL_CHARS, "");
}

// Text rendered inline, where a line break would forge structure in the output:
// every control character becomes a space, and the runs that leaves collapse —
// the indentation that followed a stripped newline is not meaningful once the
// line break is gone.
function cleanLine(s: string): string {
  return s.replace(CONTROL_CHARS_AND_BREAKS, " ").replace(/\s+/g, " ").trim();
}

// Mutates in place: the caller either just parsed this object or is about to
// serialize it, and a copy would leave the original as the one that gets written.
export function sanitizeRoute(route: Route): Route {
  if (route.title !== undefined) route.title = cleanLine(route.title);
  if (route.description !== undefined) route.description = cleanBlock(route.description);
  for (const t of route.tacks) {
    t.summary = cleanLine(t.summary);
    if (t.deliverable) t.deliverable.label = cleanLine(t.deliverable.label);
    for (const l of t.links ?? []) l.label = cleanLine(l.label);
  }
  return route;
}

function routeSlugs(): string[] {
  const slugs: string[] = [];
  for (const year of years()) {
    for (const f of readdirSync(yearDir(year))) {
      if (f.endsWith(".yaml")) slugs.push(f.replace(/\.yaml$/, ""));
    }
  }
  return slugs;
}

export interface InvalidRoute {
  // The filename stem, which is how the user addresses the route and names the
  // file they have to open.
  slug: string;
  file: string;
  errors: string[];
}

// Route files this process passed over. Keyed by slug so one run reports each
// file once, however many scans it made — a listing and the URL-collision check
// behind it both walk the store.
const skipped = new Map<string, InvalidRoute>();

export function invalidRoutes(): InvalidRoute[] {
  return [...skipped.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

// The server re-scans on every request and the test suite drives many stores
// through one process; both need the record to start empty rather than carry
// the previous scan's findings.
export function clearInvalidRoutes(): void {
  skipped.clear();
}

function recordSkip(slug: string, errors: string[]): void {
  skipped.set(slug, { slug, file: routePath(slug), errors });
}

// Load every route file, recording the ones that cannot be read instead of
// stopping at the first ([STORE-09]). The caller renders what it got and the
// CLI reports `invalidRoutes()` before exiting non-zero, so the gap is loud:
// a skipped route that nothing mentions is the invisible route this used to
// fail hard to avoid.
export function scanAll(): Route[] {
  const routes: Route[] = [];
  for (const slug of routeSlugs()) {
    const read = readRoute(slug);
    if ("route" in read) routes.push(read.route);
    else recordSkip(slug, read.errors);
  }
  return routes;
}

// Every route file, or a throw naming the first that cannot be read. For the
// callers whose answer is wrong when it is incomplete — the export archive,
// where a quietly omitted route is a lossy backup wearing a zero exit.
export function loadAll(): Route[] {
  return routeSlugs().map((slug) => load(slug));
}

function ensureDir(year: string): void {
  const dir = yearDir(year);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// The year a route already sits under, else the one its timestamp puts it in.
// Passing the route's own `created_at` is what lands a new file in the right
// place; a lookup by slug alone falls back to the current year, which is where
// a route that does not exist yet would be created.
function routePath(slug: string, createdAt?: string): string {
  for (const year of years()) {
    const candidate = join(yearDir(year), `${slug}.yaml`);
    if (existsSync(candidate)) return candidate;
  }
  const year = String(createdAt ?? new Date().toISOString()).slice(0, 4);
  return join(yearDir(year), `${slug}.yaml`);
}

function now(): string {
  return new Date().toISOString();
}

// Repo-database capture (REPO-06, REPO-07) is best-effort: it enriches the repo
// index as a side effect of recording URLs and pinning, and must never fail
// the command that triggered it.
function captureBestEffort(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    process.stderr.write(`warning: repo capture failed: ${(e as Error).message}\n`);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function normalizeTimestamp(input: string): string {
  if (ISO_DATE.test(input) || ISO_DATE_TIME.test(input)) {
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) return input;
  }
  throw new Error(
    `Invalid timestamp: ${input} (expected YYYY-MM-DD or ISO 8601 date-time)`,
  );
}

// The ways a route file refuses to load, returned as an enumerable list rather
// than a thrown string: the tolerant scan and `tack doctor` both need the
// individual reasons, and load() renders the same list into its own message.
type RouteRead = { route: Route } | { errors: string[] };

function readRoute(slug: string): RouteRead {
  const path = routePath(slug);
  if (!existsSync(path)) {
    throw new Error(`Route not found: ${slug}`);
  }

  let data: unknown;
  try {
    data = parse(readFileSync(path, "utf-8"));
  } catch (e) {
    // The parser's own message carries the line and column; the frames after
    // its first line are the YAML library's, not the user's file.
    return { errors: [`not parseable as YAML: ${(e as Error).message.split("\n")[0]}`] };
  }

  const result = validate(data);
  if (!result.valid) return { errors: result.errors };

  // The filename is how a route is addressed; save() writes back to
  // routePath(route.slug). A file whose internal slug disagrees would load here
  // and then be written to the other name on the next mutation, renaming the
  // route with nothing said.
  const loaded = data as Route;
  if (loaded.slug !== slug) {
    return {
      errors: [
        `declares slug '${loaded.slug}' — rename the file to ${loaded.slug}.yaml, ` +
          `or set slug: ${slug} inside it`,
      ],
    };
  }

  return { route: sanitizeRoute(loaded) };
}

export function load(slug: string): Route {
  const read = readRoute(slug);
  if ("route" in read) return read.route;
  throw new Error(`Invalid route file ${slug}.yaml:\n${read.errors.join("\n")}`);
}

// A tack date may be a bare `YYYY-MM-DD` (accepted for backward compatibility),
// but `created_at` is date-time in the schema, so widen before adopting one.
function asDateTime(date: string): string {
  return date.includes("T") ? date : `${date}T00:00:00.000Z`;
}

// A route's creation cannot postdate its own work. Routes built by a
// consolidation pass stamp created_at = now() while the tacks backfilled into
// them carry historical dates, which left routes whose earliest tack predates
// their own creation by months.
//
// The floor only ratchets earlier. A full min/max recompute would shove
// creation forward when the earliest tack is deleted, and a route's birth is
// monotonic — it does not un-happen. `updated_at` stays touch-on-write for the
// same reason in reverse: it has to bump on mutations that touch no tack date
// at all (rename, regroup, a link added), which a max-of-children can't see.
function floorCreatedAt(route: Route): void {
  const earliest = route.tacks
    .map((t) => t.done_at)
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  if (earliest && asDateTime(earliest) < route.created_at) {
    route.created_at = asDateTime(earliest);
  }
}

function save(route: Route): void {
  ensureDir(String(route.created_at).slice(0, 4));
  route.updated_at = now();
  floorCreatedAt(route);
  // Every mutation lands here, which is where the text a command just supplied
  // gets cleaned — `tack describe --file -` reads a forge issue body off stdin.
  sanitizeRoute(route);

  const result = validate(route);
  if (!result.valid) {
    throw new Error(`Route validation failed:\n${result.errors.join("\n")}`);
  }

  writeFileSync(routePath(route.slug, route.created_at), stringify(route), "utf-8");
}

// Import/restore: write a route object verbatim (validated) without bumping
// updated_at, so a full restore preserves timestamps and a merge sets its own.
export function writeRoute(route: Route): void {
  ensureDir(String(route.created_at).slice(0, 4));
  // An imported archive is as untrusted as a forge issue body — it arrives from
  // another machine — and this path bypasses load(), so it cleans its own input.
  sanitizeRoute(route);
  const result = validate(route);
  if (!result.valid) {
    throw new Error(`Route validation failed:\n${result.errors.join("\n")}`);
  }
  writeFileSync(routePath(route.slug, route.created_at), stringify(route), "utf-8");
}

export function routeExists(slug: string): boolean {
  return existsSync(routePath(slug));
}

export function init(slug: string, opts: { group?: string } = {}): Route {
  assertValidSlug(slug);
  if (opts.group) assertValidSlug(opts.group, "group");
  const path = routePath(slug);
  if (existsSync(path)) {
    throw new Error(`Route already exists: ${slug}`);
  }

  const route: Route = {
    id: randomUUID(),
    slug,
    created_at: now(),
    updated_at: now(),
    tacks: [],
  };

  if (opts.group) route.group = opts.group;

  save(route);
  captureBestEffort(() => repos.recordCwd(process.cwd()));
  return route;
}

export function list(): { slug: string; title?: string; group?: string; total: number; open: number; state: "active" | "done" }[] {
  return scanAll().map((r) => ({
    slug: r.slug, title: r.title, group: r.group, total: r.tacks.length, open: r.tacks.filter(isOpen).length,
    state: routeState(r),
  }));
}

function nextTackNumber(route: Route): number {
  if (route.tacks.length === 0) return 1;
  const max = Math.max(...route.tacks.map((t) => parseInt(t.id.slice(1), 10)));
  if (Number.isNaN(max)) {
    throw new Error(
      `Route ${route.slug} has a tack with a non-numeric id; cannot compute next id`,
    );
  }
  return max + 1;
}

function nextTackId(route: Route): string {
  return `t${nextTackNumber(route)}`;
}

// Tack ids display as `t<N>`, but a bare `<N>` is the natural thing to type.
// Normalize both forms to the canonical `t<N>` at the lookup boundary so every
// subcommand that takes a tack id accepts `7` and `t7` interchangeably. Inputs
// that aren't a tack id are returned unchanged, so a bad value still surfaces
// the same "not found" error.
export function normalizeTackId(id: string): string {
  const m = id.match(/^t?(\d+)$/);
  return m ? `t${m[1]}` : id;
}

function findTack(route: Route, tackId: string): Tack {
  const id = normalizeTackId(tackId);
  const tack = route.tacks.find((t) => t.id === id);
  if (!tack) {
    throw new Error(`Tack not found: ${id} in route ${route.slug}`);
  }
  return tack;
}

/**
 * A `depends_on` entry addresses a tack either in the route carrying it (bare
 * `t<N>`) or in another route (`<slug>/t<N>`) [DEPENDS-02]. Resolving one always
 * needs the carrying route's slug — that is what makes the bare form concrete.
 */
export interface DepRef {
  slug: string;
  tackId: string;
}

export function parseDepRef(entry: string, localSlug: string): DepRef {
  const slash = entry.indexOf("/");
  if (slash < 0) return { slug: localSlug, tackId: normalizeTackId(entry) };
  return {
    slug: entry.slice(0, slash),
    tackId: normalizeTackId(entry.slice(slash + 1)),
  };
}

// A route's own edges are stored bare, so renaming a route never has to rewrite
// its references to itself [DEPENDS-02].
export function formatDepRef(ref: DepRef, localSlug: string): string {
  return ref.slug === localSlug ? ref.tackId : `${ref.slug}/${ref.tackId}`;
}

// Cross-route resolution reads other route files, so a walk (cycle detection, an
// unmet-dependency scan) caches them and stays at one read per route. A route
// that will not load resolves to null rather than throwing — the caller decides
// whether a missing route is an error here or a dangling edge to report.
function routeResolver(seed?: Route): (slug: string) => Route | null {
  const cache = new Map<string, Route | null>();
  if (seed) cache.set(seed.slug, seed);
  return (slug: string) => {
    if (!cache.has(slug)) {
      let loaded: Route | null = null;
      try {
        loaded = load(slug);
      } catch {
        loaded = null;
      }
      cache.set(slug, loaded);
    }
    return cache.get(slug)!;
  };
}

function checkDependencies(route: Route, dependsOn: string[]): void {
  const resolve = routeResolver(route);
  for (const entry of dependsOn) {
    const ref = parseDepRef(entry, route.slug);
    const target = resolve(ref.slug);
    if (!target) {
      throw new Error(`Dependency not found: ${entry} (no route ${ref.slug})`);
    }
    if (!target.tacks.some((t) => t.id === ref.tackId)) {
      throw new Error(`Dependency not found: ${entry}`);
    }
  }
}

function detectCycle(route: Route, tackId: string, dependsOn: string[]): void {
  const resolve = routeResolver(route);
  const origin = `${route.slug}/${normalizeTackId(tackId)}`;
  const visited = new Set<string>();

  // Follows edges across route boundaries [DEPENDS-04], so a cycle spanning two
  // routes fails the same way a within-route one does.
  function walk(ref: DepRef): void {
    const key = `${ref.slug}/${ref.tackId}`;
    if (key === origin) {
      throw new Error(`Circular dependency detected involving ${origin}`);
    }
    if (visited.has(key)) return;
    visited.add(key);
    const tack = resolve(ref.slug)?.tacks.find((t) => t.id === ref.tackId);
    for (const entry of tack?.depends_on ?? []) {
      walk(parseDepRef(entry, ref.slug));
    }
  }

  for (const entry of dependsOn) walk(parseDepRef(entry, route.slug));
}

/**
 * Every `<slug>/t<N>` reference to `targetSlug` held by any other route, so a
 * rename can rewrite them [DEPENDS-05] and a delete can refuse over them
 * [DEPENDS-06].
 */
export interface InboundRef {
  /** Route holding the dependent tack. */
  slug: string;
  /** The dependent tack's id within that route. */
  from: string;
  /** The tack being depended on, in `targetSlug`. */
  target: string;
  /** The `depends_on` entry verbatim, for an exact-match rewrite or strip. */
  dependsOn: string;
}

export function inboundRefs(targetSlug: string, tackId?: string): InboundRef[] {
  const wanted = tackId ? normalizeTackId(tackId) : undefined;
  const found: InboundRef[] = [];
  for (const other of loadAll()) {
    if (other.slug === targetSlug) continue;
    for (const t of other.tacks) {
      for (const entry of t.depends_on ?? []) {
        const ref = parseDepRef(entry, other.slug);
        if (ref.slug !== targetSlug) continue;
        if (wanted && ref.tackId !== wanted) continue;
        found.push({
          slug: other.slug,
          from: t.id,
          target: ref.tackId,
          dependsOn: entry,
        });
      }
    }
  }
  return found;
}

export function addTack(
  slug: string,
  summary: string,
  opts: {
    dependsOn?: string[];
    done?: boolean;
    doneAt?: string;
    deliverable?: { label: string; url: string };
    links?: Link[];
  } = {}
): Tack {
  assertLineLength(summary, "tack.summary", "tack summary");
  const route = load(slug);
  const id = nextTackId(route);

  // Through the dep-ref pair, not `normalizeTackId` alone: an edge naming this
  // route by its own slug is stored bare [DEPENDS-02], the same shape
  // `tack depends add` writes for it.
  const dependsOn = opts.dependsOn?.map((entry) =>
    formatDepRef(parseDepRef(entry, route.slug), route.slug),
  );
  if (dependsOn?.length) {
    checkDependencies(route, dependsOn);
    detectCycle(route, id, dependsOn);
  }

  const tack: Tack = {
    id,
    summary,
    status: opts.done ? "done" : "pending",
  };

  if (dependsOn?.length) tack.depends_on = dependsOn;
  if (opts.deliverable) tack.deliverable = opts.deliverable;
  if (opts.done) tack.done_at = opts.doneAt ? normalizeTimestamp(opts.doneAt) : now();

  // Attach any links, deduping against the deliverable and each other so
  // `--link` on creation obeys the same no-op-on-duplicate rule as `link add`.
  if (opts.links?.length) {
    const links: Link[] = [];
    for (const link of opts.links) {
      if (tack.deliverable?.url === link.url) continue;
      if (links.some((l) => l.url === link.url)) continue;
      links.push(link);
    }
    if (links.length) tack.links = links;
  }

  route.tacks.push(tack);
  save(route);
  if (opts.deliverable) captureBestEffort(() => repos.recordUrl(opts.deliverable!.url));
  if (tack.links) {
    for (const link of tack.links) captureBestEffort(() => repos.recordUrl(link.url));
  }
  return tack;
}

export function markDone(
  slug: string,
  tackId: string,
  opts: { at?: string } = {},
): { tack: Tack; ambiguousDeliverable: Link[] } {
  const route = load(slug);
  const tack = findTack(route, tackId);

  tack.status = "done";
  if (opts.at) {
    tack.done_at = normalizeTimestamp(opts.at);
  } else if (!tack.done_at) {
    tack.done_at = now();
  }

  let ambiguousDeliverable: Link[] = [];
  let promotedUrl: string | undefined;
  if (!tack.deliverable && tack.links?.length) {
    const prLinks = tack.links.filter((l) => isPrOrMrUrl(l.url));
    if (prLinks.length === 1) {
      const prLink = prLinks[0];
      tack.deliverable = { label: prLink.label, url: prLink.url };
      promotedUrl = prLink.url;
      tack.links = tack.links.filter((l) => l !== prLink);
      if (tack.links.length === 0) delete tack.links;
    } else if (prLinks.length > 1) {
      ambiguousDeliverable = prLinks.map((l) => ({ label: l.label, url: l.url }));
    }
  }

  save(route);
  if (promotedUrl) captureBestEffort(() => repos.recordUrl(promotedUrl!));
  return { tack, ambiguousDeliverable };
}

export function markDropped(slug: string, tackId: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  tack.status = "dropped";
  save(route);
  return tack;
}

export function startTack(slug: string, tackId: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);

  if (tack.depends_on?.length) {
    const resolve = routeResolver(route);
    const unmet = tack.depends_on.filter((entry) => {
      const ref = parseDepRef(entry, route.slug);
      const dep = resolve(ref.slug)?.tacks.find((t) => t.id === ref.tackId);
      return dep && dep.status !== "done";
    });
    if (unmet.length) {
      throw new Error(
        `Cannot start ${tackId}: unmet dependencies: ${unmet.join(", ")}. ` +
          `Drop the edge with \`tack depends rm ${slug} ${tackId} <dep-id>\` ` +
          `if these are actually parallel, or use \`tack status set ${slug} ${tackId} in_progress\` ` +
          `to write the status anyway.`,
      );
    }
  }

  tack.status = "in_progress";
  save(route);
  return tack;
}

export function setStatus(
  slug: string,
  tackId: string,
  status: TackStatus,
): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  tack.status = status;
  if (status === "done" && !tack.done_at) {
    tack.done_at = now();
  }
  save(route);
  return tack;
}

export function addDependency(
  slug: string,
  tackId: string,
  depId: string,
): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  const ref = parseDepRef(depId, route.slug);
  const entry = formatDepRef(ref, route.slug);

  if (ref.slug === route.slug && tack.id === ref.tackId) {
    throw new Error(`Cannot depend on self: ${tack.id}`);
  }
  checkDependencies(route, [entry]);

  if (tack.depends_on?.includes(entry)) {
    return tack;
  }

  const proposed = [...(tack.depends_on ?? []), entry];
  detectCycle(route, tack.id, proposed);

  tack.depends_on = proposed;
  save(route);
  return tack;
}

export function removeDependency(
  slug: string,
  tackId: string,
  depId: string,
): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  const entry = formatDepRef(parseDepRef(depId, route.slug), route.slug);

  if (!tack.depends_on?.includes(entry)) {
    throw new Error(
      `${tack.id} does not depend on ${entry} in route ${slug}`,
    );
  }

  tack.depends_on = tack.depends_on.filter((id) => id !== entry);
  if (tack.depends_on.length === 0) delete tack.depends_on;

  save(route);
  return tack;
}

export function rename(oldSlug: string, newSlug: string): Route {
  assertValidSlug(newSlug);
  if (oldSlug === newSlug) {
    throw new Error(`Old and new slug are the same: ${oldSlug}`);
  }

  const oldPath = routePath(oldSlug);
  if (!existsSync(oldPath)) {
    throw new Error(`Route not found: ${oldSlug}`);
  }

  const route = load(oldSlug);

  // The renamed file stays in the year the route was opened in [STORE-01b], so
  // its year comes from `created_at` rather than from today.
  const newYear = String(route.created_at).slice(0, 4);
  const newPath = join(yearDir(newYear), `${newSlug}.yaml`);
  if (existsSync(newPath)) {
    throw new Error(`Route already exists: ${newSlug}`);
  }

  route.slug = newSlug;
  route.updated_at = now();

  const result = validate(route);
  if (!result.valid) {
    throw new Error(`Route validation failed:\n${result.errors.join("\n")}`);
  }

  // Inbound cross-route edges name this route by slug, so they are rewritten in
  // the same operation [DEPENDS-05]. Every dependent is validated before
  // anything is written, so a rename that cannot complete leaves nothing half
  // done.
  const dependents = new Map<string, Route>();
  for (const { slug } of inboundRefs(oldSlug)) {
    if (!dependents.has(slug)) dependents.set(slug, load(slug));
  }
  for (const dep of dependents.values()) {
    for (const t of dep.tacks) {
      if (!t.depends_on) continue;
      t.depends_on = t.depends_on.map((entry) => {
        const ref = parseDepRef(entry, dep.slug);
        return ref.slug === oldSlug
          ? formatDepRef({ slug: newSlug, tackId: ref.tackId }, dep.slug)
          : entry;
      });
    }
    dep.updated_at = now();
    const depResult = validate(dep);
    if (!depResult.valid) {
      throw new Error(
        `Cannot rename ${oldSlug}: dependent route ${dep.slug} would not validate:\n` +
          depResult.errors.join("\n"),
      );
    }
  }

  // The new file is written before the old one is removed, so a failure at
  // either step leaves a readable route behind: the old file untouched if the
  // write fails, both files if the removal does. Rewriting the slug into the old
  // file first would leave a file whose name and `slug` disagree, which [STORE-07]
  // then refuses to load.
  ensureDir(newYear);
  writeFileSync(newPath, stringify(route), "utf-8");
  unlinkSync(oldPath);
  for (const dep of dependents.values()) writeRoute(dep);

  // Session refs name this route by slug too, for the reason the inbound edges
  // do — both the tacks they drove and the touch list they sit in.
  sessions.remapRefs(
    new Map(
      route.tacks.map((t) => [
        sessions.tackRef(oldSlug, t.id),
        sessions.tackRef(newSlug, t.id),
      ]),
    ),
    new Map([[oldSlug, newSlug]]),
  );
  return route;
}

export function setGroup(slug: string, group: string): Route {
  // load() first: a missing route is a fact about the argument the caller named,
  // and reporting it takes precedence over the group's shape.
  const route = load(slug);
  assertValidSlug(group, "group");
  route.group = group;
  save(route);
  return route;
}

export function clearGroup(slug: string): Route {
  const route = load(slug);
  delete route.group;
  save(route);
  return route;
}

export function setTitle(slug: string, title: string): Route {
  assertLineLength(title, "route.title", "route title");
  const route = load(slug);
  route.title = title;
  save(route);
  return route;
}

export function clearTitle(slug: string): Route {
  const route = load(slug);
  delete route.title;
  save(route);
  return route;
}

export function setDescription(slug: string, description: string): Route {
  assertBlockLength(description, "route.description", "route description");
  const route = load(slug);
  route.description = description;
  save(route);
  return route;
}

export function clearDescription(slug: string): Route {
  const route = load(slug);
  delete route.description;
  save(route);
  return route;
}

export function setDeliverable(
  slug: string,
  tackId: string,
  label: string,
  url: string,
  opts: { force?: boolean } = {},
): Tack {
  assertLineLength(label, "deliverable.label", "deliverable label");
  assertLength(url, "deliverable.url", "deliverable url");
  const route = load(slug);
  const tack = findTack(route, tackId);
  if (tack.deliverable && !opts.force) {
    const existing = `${tack.deliverable.label} — ${tack.deliverable.url}`;
    throw new Error(
      `${tackId} already has a deliverable: ${existing}. Pass --force to overwrite.`,
    );
  }
  tack.deliverable = { label, url };
  if (tack.links?.length) {
    tack.links = tack.links.filter((l) => l.url !== url);
    if (tack.links.length === 0) delete tack.links;
  }
  save(route);
  captureBestEffort(() => repos.recordUrl(url));
  return tack;
}

export function removeDeliverable(
  slug: string,
  tackId: string,
  opts: { toLink?: boolean } = {},
): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  if (!tack.deliverable) {
    throw new Error(`${slug}/${tackId} has no deliverable to remove.`);
  }
  const { label, url } = tack.deliverable;
  delete tack.deliverable;
  // --to-link relocates the URL into links. Clearing the deliverable first
  // sidesteps addLink's dedupe no-op (which skips a URL still held as the
  // deliverable); the demoted link is only skipped when the URL is already
  // present in links, matching tack's existing dedupe behavior.
  if (opts.toLink && !tack.links?.some((l) => l.url === url)) {
    if (!tack.links) tack.links = [];
    tack.links.push({ label, url });
  }
  save(route);
  return tack;
}

type ChangeRefKind = "pr" | "mr" | "issue" | "commit" | "epic" | "milestone";
interface ChangeRef {
  repo: string;
  // PR/MR/issue/epic/milestone number, or the abbreviated (7-char) sha for a
  // commit.
  ref: string;
  kind: ChangeRefKind;
}

function parseChangeRefUrl(url: string): ChangeRef | null {
  const gh = url.match(
    /^https:\/\/github\.com\/[^/]+\/([^/]+)\/(pull|issues)\/(\d+)/,
  );
  if (gh) {
    return { repo: gh[1], ref: gh[3], kind: gh[2] === "pull" ? "pr" : "issue" };
  }
  const ghCommit = url.match(
    /^https:\/\/github\.com\/[^/]+\/([^/]+)\/commit\/([0-9a-f]+)/i,
  );
  if (ghCommit) {
    return { repo: ghCommit[1], ref: ghCommit[2].slice(0, 7), kind: "commit" };
  }
  // `work_items` is GitLab's newer path for the same issue `/-/issues/<n>`
  // serves, so it derives the same ref. Epics live under /groups/<group>/-/,
  // which puts the group where a project name sits in the other forms — the
  // captured name is the group, which is what an epic belongs to.
  const gl = url.match(
    /^https:\/\/gitlab\.[^/]*\/.*?\/([^/]+)\/-\/(merge_requests|issues|work_items|epics|milestones)\/(\d+)/,
  );
  if (gl) {
    const kinds: Record<string, ChangeRefKind> = {
      merge_requests: "mr",
      issues: "issue",
      work_items: "issue",
      epics: "epic",
      milestones: "milestone",
    };
    return { repo: gl[1], ref: gl[3], kind: kinds[gl[2]] };
  }
  const glCommit = url.match(
    /^https:\/\/gitlab\.[^/]*\/.*?\/([^/]+)\/-\/commit\/([0-9a-f]+)/i,
  );
  if (glCommit) {
    return { repo: glCommit[1], ref: glCommit[2].slice(0, 7), kind: "commit" };
  }
  return null;
}

export function isPrOrMrUrl(url: string): boolean {
  const ref = parseChangeRefUrl(url);
  return ref !== null && (ref.kind === "pr" || ref.kind === "mr");
}

// Canonical forge notation attaches a kind-specific sigil to the repo:
// `repo#42` for a PR/issue, `repo!99` for an MR, `repo@<sha7>` for a commit.
// Epics and milestones reuse GitLab's own reference syntax, `&` and `%`.
const CHANGE_REF_SIGIL: Record<ChangeRefKind, string> = {
  pr: "#",
  issue: "#",
  mr: "!",
  commit: "@",
  epic: "&",
  milestone: "%",
};

export function deriveDeliverableLabel(url: string): string {
  const ref = parseChangeRefUrl(url);
  if (!ref) return url;
  return `${ref.repo}${CHANGE_REF_SIGIL[ref.kind]}${ref.ref}`;
}

export function addLink(slug: string, tackId: string, label: string, url: string): Tack {
  assertLineLength(label, "link.label", "link label");
  assertLength(url, "link.url", "link url");
  const route = load(slug);
  const tack = findTack(route, tackId);

  if (tack.deliverable?.url === url) return tack;
  if (tack.links?.some((l) => l.url === url)) return tack;

  if (!tack.links) tack.links = [];
  tack.links.push({ label, url });

  save(route);
  captureBestEffort(() => repos.recordUrl(url));
  return tack;
}

export function removeLink(slug: string, tackId: string, url: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  const idx = tack.links?.findIndex((l) => l.url === url) ?? -1;
  if (idx < 0) {
    throw new Error(`No link with url "${url}" on ${slug}/${tackId}`);
  }
  tack.links!.splice(idx, 1);
  if (tack.links!.length === 0) delete tack.links;
  save(route);
  return tack;
}

export function editTack(slug: string, tackId: string, summary: string): Tack {
  assertLineLength(summary, "tack.summary", "tack summary");
  const route = load(slug);
  const tack = findTack(route, tackId);
  tack.summary = summary;
  save(route);
  return tack;
}

export function mergeTacks(slug: string, sourceId: string, targetId: string): Tack {
  const route = load(slug);
  const source = findTack(route, sourceId);
  const target = findTack(route, targetId);

  if (source.id === target.id) {
    throw new Error("Cannot merge a tack into itself");
  }

  if (!target.deliverable && source.deliverable) {
    target.deliverable = source.deliverable;
  }

  if (source.links?.length) {
    if (!target.links) target.links = [];
    for (const link of source.links) {
      target.links.push({ ...link });
    }
  }

  route.tacks = route.tacks.filter((t) => t.id !== source.id);

  save(route);
  // The source tack is gone but the work it held is the target's now, so a
  // session driving it is driving the target.
  sessions.remapRefs(
    new Map([[sessions.tackRef(slug, source.id), sessions.tackRef(slug, target.id)]]),
  );
  return target;
}

// The tack ids a session is driving on a route, in touch order, with whatever
// each one has recorded as its deliverable. What a session produced, which is
// the payload `session.ended` carries.
//
// The route comes back with them so a caller renders what it announced off one
// read rather than loading the file twice.
export function sessionWork(
  slug: string,
  sessionId: string,
): { route: Route; tacks: string[]; deliverables: string[] } {
  const route = load(slug);
  const ids = sessions.tacksOn(sessionId, slug);
  const deliverables = ids
    .map((id) => route.tacks.find((t) => t.id === id)?.deliverable?.url)
    .filter((url): url is string => Boolean(url));
  return { route, tacks: ids, deliverables };
}

// Record that a session touched this route, and what it is driving. The route
// file is not written at all — everything about a session lives in the session
// store, so this reads the route only to validate the tack.
export function recordSession(slug: string, sessionId: string, tackId?: string): Route {
  sessions.assertValidId(sessionId);
  const route = load(slug);
  // findTack validates existence and normalizes a bare `<N>` to `t<N>`.
  const id = tackId === undefined ? undefined : findTack(route, tackId).id;

  sessions.record(sessionId, slug, id);
  return route;
}

// The sessions that touched a route, for a caller rendering it. The answer is
// a scan of the session store, so it is made where the caller asks for it
// rather than on every render ([SESS-09]).
export function sessionsOn(slug: string): Session[] {
  return sessions.onRoute(slug);
}

// Stamp the session finished and report what it drove on this route. The stamp
// is the session's own, so it covers every route the session touched; the
// payload stays route-scoped, which is what a subscriber asked about.
export function endSession(
  slug: string,
  sessionId: string,
): { route: Route; tacks: string[]; deliverables: string[] } {
  sessions.end(sessionId);
  return sessionWork(slug, sessionId);
}

export function recent(opts: { count?: number; since?: string } = {}): { slug: string; group?: string; updated_at: string; total: number; open: number }[] {
  let routes = scanAll().map((r) => ({
    slug: r.slug, group: r.group, updated_at: r.updated_at, total: r.tacks.length, open: r.tacks.filter(isOpen).length,
  }));

  routes.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  if (opts.since) {
    const parsed = new Date(opts.since);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid --since value: ${opts.since}`);
    }
    const sinceDate = parsed.toISOString();
    routes = routes.filter((r) => r.updated_at >= sinceDate);
  }

  const count = opts.count ?? 10;
  return routes.slice(0, count);
}

export interface FindMatch {
  slug: string;
  group?: string;
  routeTotal: number;
  routeOpen: number;
  tackId: string;
  summary: string;
  status: string;
  done_at?: string;
  match: "deliverable" | "link";
  label: string;
  url: string;
}

// Scan every route/tack, collecting a FindMatch for each deliverable or link
// URL the predicate accepts. Shared by find() (exact URL) and findByRepoKey()
// (same repo), so both render identically through formatFind.
function findBy(accepts: (url: string) => boolean): FindMatch[] {
  const matches: FindMatch[] = [];

  for (const r of scanAll()) {
    const routeOpen = r.tacks.filter(isOpen).length;
    for (const tack of r.tacks) {
      const base = { slug: r.slug, group: r.group, routeTotal: r.tacks.length, routeOpen, tackId: tack.id, summary: tack.summary, status: tack.status, done_at: tack.done_at };
      if (tack.deliverable && accepts(tack.deliverable.url)) {
        matches.push({ ...base, match: "deliverable", label: tack.deliverable.label, url: tack.deliverable.url });
      }
      if (tack.links) {
        for (const link of tack.links) {
          if (accepts(link.url)) {
            matches.push({ ...base, match: "link", label: link.label, url: link.url });
          }
        }
      }
    }
  }

  return matches;
}

// GitLab serves one issue from two paths, so two recordings of the same issue
// are not string-equal. Canonicalize the newer form onto the older one for
// comparison only — stored URLs stay exactly as the caller gave them, since
// that is the link the user actually followed.
export function canonicalizeUrl(url: string): string {
  return url.replace(
    /^(https:\/\/gitlab\.[^/]*\/.*?\/-\/)work_items(\/\d+)/,
    "$1issues$2",
  );
}

export function find(url: string): FindMatch[] {
  const target = canonicalizeUrl(url);
  return findBy((u) => canonicalizeUrl(u) === target);
}

// CLI-23a: return every tack whose deliverable or link URL belongs to the given
// repo key, computed via the forge-URL recognition rules ([CLI-37]). Powers
// `tack find --path`, which resolves a working directory to a repo key first.
export function findByRepoKey(key: string): FindMatch[] {
  return findBy((u) => repos.repoKeyFromForgeUrl(u) === key);
}

// Return every tack that already references this URL, excluding the tack being
// mutated (so an idempotent re-attach to the same tack does not count as a
// collision). Reuses find()'s exact-URL matching — same rule as `tack find`.
export function findCollisions(
  url: string,
  exclude: { slug: string; tackId: string },
): FindMatch[] {
  return find(url).filter(
    (m) => !(m.slug === exclude.slug && m.tackId === exclude.tackId),
  );
}

// CLI-47: backfill the repo database from existing tack data — every forge URL
// recorded on a route.
export function rebuildRepos(): repos.RebuildResult {
  const urls: string[] = [];
  for (const r of scanAll()) {
    for (const tack of r.tacks) {
      if (tack.deliverable?.url) urls.push(tack.deliverable.url);
      for (const link of tack.links ?? []) urls.push(link.url);
    }
  }
  const srcRoot = process.env.TACK_SRC_ROOT ?? join(homedir(), "src");
  return repos.rebuildFrom({ urls, srcRoot });
}

export interface DanglingRef {
  slug: string;
  tackId: string;
  dependsOn: string;
  reason: "no such route" | "no such tack";
}

export interface DoctorReport {
  files: number;
  invalid: InvalidRoute[];
  dangling: DanglingRef[];
}

/**
 * `depends_on` entries pointing at a route or tack that isn't there [DEPENDS-07].
 * A dangling edge is valid against the schema — it is a well-formed reference to
 * something absent — so it can only be found by resolving, not by loading.
 */
export function danglingRefs(routes?: Route[]): DanglingRef[] {
  const all = routes ?? loadAll();
  const byslug = new Map(all.map((r) => [r.slug, r]));
  const out: DanglingRef[] = [];
  for (const r of all) {
    for (const t of r.tacks) {
      for (const entry of t.depends_on ?? []) {
        const ref = parseDepRef(entry, r.slug);
        const target = byslug.get(ref.slug);
        if (!target) {
          out.push({ slug: r.slug, tackId: t.id, dependsOn: entry, reason: "no such route" });
        } else if (!target.tacks.some((x) => x.id === ref.tackId)) {
          out.push({ slug: r.slug, tackId: t.id, dependsOn: entry, reason: "no such tack" });
        }
      }
    }
  }
  return out;
}

// CLI-57: read every route file and report what will not load, changing
// nothing. Repair is a hand edit, so the report's job is to name the file and
// the rule it breaks — otherwise finding that out means reading the schema.
export function doctor(): DoctorReport {
  clearInvalidRoutes();
  const routes = scanAll();
  const invalid = invalidRoutes();
  clearInvalidRoutes();
  return {
    files: routes.length + invalid.length,
    invalid,
    dangling: danglingRefs(routes),
  };
}

export function remove(slug: string, opts: { force?: boolean } = {}): void {
  const path = routePath(slug);
  if (!existsSync(path)) {
    throw new Error(`Route not found: ${slug}`);
  }

  // Deleting a route takes every tack another route may depend on with it
  // [DEPENDS-06]. The CLI already gates `tack rm` behind --force, so this
  // reports what would break rather than gating a second time.
  const foreign = inboundRefs(slug);
  if (foreign.length > 0 && !opts.force) {
    const who = foreign.map((r) => `${r.slug}/${r.from} → ${r.dependsOn}`);
    throw new Error(
      `Cannot delete ${slug}: depended on by ${who.join(", ")}. ` +
        `Pass --force to strip those references.`,
    );
  }

  unlinkSync(path);
  for (const other of stripInbound(foreign)) writeRoute(other);
}

export interface MoveResult {
  srcRoute: Route;
  dstRoute: Route;
  moved: { srcId: string; dstId: string; summary: string }[];
}

export function moveTack(
  srcSlug: string,
  srcTackId: string,
  dstSlug: string,
  opts: { includeDependents?: boolean } = {},
): MoveResult {
  if (srcSlug === dstSlug) {
    throw new Error(`Source and destination routes are the same: ${srcSlug}`);
  }

  const srcRoute = load(srcSlug);
  const dstRoute = load(dstSlug);
  // The canonical id, not the argument: a bare `<N>` names the same tack as
  // `t<N>` [TACK-08], and the partition below matches on `t.id`.
  const srcTackCanonicalId = findTack(srcRoute, srcTackId).id;

  const movingIds = new Set<string>([srcTackCanonicalId]);
  if (opts.includeDependents) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of srcRoute.tacks) {
        if (movingIds.has(t.id)) continue;
        if (t.depends_on?.some((dep) => movingIds.has(dep))) {
          movingIds.add(t.id);
          changed = true;
        }
      }
    }
  }

  const moving = srcRoute.tacks.filter((t) => movingIds.has(t.id));
  const staying = srcRoute.tacks.filter((t) => !movingIds.has(t.id));

  let nextN = nextTackNumber(dstRoute);
  const idMap = new Map<string, string>();
  for (const t of moving) idMap.set(t.id, `t${nextN++}`);

  // An edge that used to be route-local becomes a cross-route one rather than
  // blocking the move: a moving tack keeps pointing at what stayed behind, and a
  // staying tack follows what left.
  const movedReport: { srcId: string; dstId: string; summary: string }[] = [];
  for (const src of moving) {
    const dst: Tack = { ...structuredClone(src), id: idMap.get(src.id)! };
    if (src.depends_on?.length) {
      dst.depends_on = src.depends_on.map((entry) => {
        const ref = parseDepRef(entry, srcSlug);
        if (ref.slug !== srcSlug) return entry;
        const moved = idMap.get(ref.tackId);
        return moved
          ? formatDepRef({ slug: dstSlug, tackId: moved }, dstSlug)
          : formatDepRef(ref, dstSlug);
      });
    }

    dstRoute.tacks.push(dst);
    movedReport.push({ srcId: src.id, dstId: dst.id, summary: src.summary });
  }

  for (const t of staying) {
    if (!t.depends_on?.length) continue;
    t.depends_on = t.depends_on.map((entry) => {
      const ref = parseDepRef(entry, srcSlug);
      if (ref.slug !== srcSlug) return entry;
      const moved = idMap.get(ref.tackId);
      return moved
        ? formatDepRef({ slug: dstSlug, tackId: moved }, srcSlug)
        : entry;
    });
  }

  srcRoute.tacks = staying;

  // A third route pointing at a tack that just moved follows it to its new
  // route and id, so the edge survives the move the same way the local ones do.
  const followers = new Map<string, Route>();
  for (const ref of inboundRefs(srcSlug)) {
    const moved = idMap.get(ref.target);
    if (!moved || ref.slug === dstSlug) continue;
    if (!followers.has(ref.slug)) followers.set(ref.slug, load(ref.slug));
    const other = followers.get(ref.slug)!;
    const t = other.tacks.find((x) => x.id === ref.from);
    if (!t?.depends_on) continue;
    t.depends_on = t.depends_on.map((entry) =>
      entry === ref.dependsOn
        ? formatDepRef({ slug: dstSlug, tackId: moved }, other.slug)
        : entry,
    );
    other.updated_at = now();
  }

  // A session that drove a moved tack follows it: the ref is rewritten, and
  // the destination joins its touch list. The source stays on that list — the
  // session did work there, and the move doesn't unmake it.
  sessions.remapRefs(
    new Map(
      [...idMap].map(([oldId, newId]) => [
        sessions.tackRef(srcSlug, oldId),
        sessions.tackRef(dstSlug, newId),
      ]),
    ),
  );

  save(dstRoute);
  save(srcRoute);
  for (const other of followers.values()) writeRoute(other);

  return { srcRoute, dstRoute, moved: movedReport };
}

export interface MergeRoutesResult {
  route: Route;
  sources: { slug: string; moved: { srcId: string; dstId: string; summary: string }[] }[];
}

// Fold every source route into one new route. Morally `init` + N×`moveTack` +
// N×`remove`, but done as one pass so destination t-IDs land in chronological
// order rather than command order, and the umbrella route's created_at reflects
// the work's real age rather than today (issue #8).
export function mergeRoutes(
  newSlug: string,
  srcSlugs: string[],
  opts: { group?: string; createdAt?: string } = {},
): MergeRoutesResult {
  if (srcSlugs.length === 0) {
    throw new Error("merge-routes requires at least one source route");
  }
  // The destination is created from these arguments, so they get the same
  // boundary check as init's ([STORE-08]) rather than reaching save().
  assertValidSlug(newSlug);
  if (opts.group) assertValidSlug(opts.group, "group");
  const srcSet = new Set<string>();
  for (const s of srcSlugs) {
    if (srcSet.has(s)) throw new Error(`Duplicate source route: ${s}`);
    srcSet.add(s);
  }
  // Merging into an existing destination is a separate sub-flow (issue #8, out
  // of scope): the destination is always created fresh here.
  if (srcSet.has(newSlug)) {
    throw new Error(`Destination ${newSlug} cannot also be a source route`);
  }
  if (routeExists(newSlug)) {
    throw new Error(`Route already exists: ${newSlug}`);
  }

  const sources = srcSlugs.map((s) => load(s));

  // Order every tack across all sources chronologically: by done_at, falling
  // back to the source route's created_at for open tacks, then source created_at
  // and original numeric id as tiebreakers.
  const numId = (id: string) => {
    const n = parseInt(id.slice(1), 10);
    return Number.isNaN(n) ? 0 : n;
  };
  const entries = sources.flatMap((src) => src.tacks.map((tack) => ({ tack, src })));
  entries.sort((a, b) => {
    const ka = a.tack.done_at ?? a.src.created_at;
    const kb = b.tack.done_at ?? b.src.created_at;
    if (ka !== kb) return ka < kb ? -1 : 1;
    if (a.src.created_at !== b.src.created_at) return a.src.created_at < b.src.created_at ? -1 : 1;
    return numId(a.tack.id) - numId(b.tack.id);
  });

  // Build every source's old→new id map before remapping, since a dep can point
  // at a tack anywhere in its own route — or, now, in another source being
  // folded in by the same merge, which collapses that edge to a local one.
  const idMapBySrc = new Map<string, Map<string, string>>(srcSlugs.map((s) => [s, new Map()]));
  entries.forEach((e, i) => idMapBySrc.get(e.src.slug)!.set(e.tack.id, `t${i + 1}`));

  const newTacks: Tack[] = entries.map((e) => {
    const map = idMapBySrc.get(e.src.slug)!;
    const clone: Tack = { ...structuredClone(e.tack), id: map.get(e.tack.id)! };
    if (e.tack.depends_on?.length) {
      clone.depends_on = e.tack.depends_on.map((entry) => {
        const ref = parseDepRef(entry, e.src.slug);
        const inMerge = idMapBySrc.get(ref.slug)?.get(ref.tackId);
        // A dep on another source becomes local; one on a route outside the
        // merge keeps pointing where it did.
        if (inMerge) return inMerge;
        if (!srcSet.has(ref.slug)) return formatDepRef(ref, newSlug);
        throw new Error(
          `Source route ${e.src.slug} tack ${e.tack.id} depends on ${entry}, which is not in the route`,
        );
      });
    }
    return clone;
  });

  // `<srcSlug>/<oldId>` → `<newSlug>/<newId>` for every tack the merge moved,
  // and every source slug → the merged one: the sources are deleted, so a
  // touch list still naming them would point at nothing.
  const refMap = new Map<string, string | null>();
  const slugMap = new Map<string, string | null>();
  for (const src of sources) {
    slugMap.set(src.slug, newSlug);
    for (const [oldId, newId] of idMapBySrc.get(src.slug)!) {
      refMap.set(sessions.tackRef(src.slug, oldId), sessions.tackRef(newSlug, newId));
    }
  }

  const createdAt = opts.createdAt
    ? new Date(normalizeTimestamp(opts.createdAt)).toISOString()
    : sources.map((s) => s.created_at).sort()[0];

  const merged: Route = {
    id: randomUUID(),
    slug: newSlug,
    created_at: createdAt,
    updated_at: now(),
    tacks: newTacks,
  };
  const group = opts.group ?? sources.find((s) => s.group)?.group;
  if (group) merged.group = group;
  const title = sources.find((s) => s.title)?.title;
  if (title) merged.title = title;
  // Descriptions are hand-written prose, so every source's body carries over
  // rather than the first one winning: the merge deletes the source files, and
  // the merged route is the only place left to rewrite them from.
  const descriptions = sources.map((s) => s.description).filter((d): d is string => Boolean(d));
  if (descriptions.length) merged.description = descriptions.join("\n\n---\n\n");

  // A route outside the merge that depended on a source follows it into the
  // merged route, at the id that source's tack now carries. Collected before
  // the sources are deleted, and written after the merged route exists.
  const followers = new Map<string, Route>();
  for (const src of srcSlugs) {
    for (const ref of inboundRefs(src)) {
      if (srcSet.has(ref.slug)) continue;
      const moved = idMapBySrc.get(src)!.get(ref.target);
      if (!moved) continue;
      if (!followers.has(ref.slug)) followers.set(ref.slug, load(ref.slug));
      const other = followers.get(ref.slug)!;
      const t = other.tacks.find((x) => x.id === ref.from);
      if (!t?.depends_on) continue;
      t.depends_on = t.depends_on.map((entry) =>
        entry === ref.dependsOn
          ? formatDepRef({ slug: newSlug, tackId: moved }, other.slug)
          : entry,
      );
      other.updated_at = now();
    }
  }

  save(merged);
  for (const other of followers.values()) writeRoute(other);
  sessions.remapRefs(refMap, slugMap);

  for (const s of srcSlugs) remove(s, { force: true });

  const report = sources.map((src) => ({
    slug: src.slug,
    moved: src.tacks.map((t) => ({
      srcId: t.id,
      dstId: idMapBySrc.get(src.slug)!.get(t.id)!,
      summary: t.summary,
    })),
  }));

  return { route: merged, sources: report };
}

export function removeTack(
  slug: string,
  tackId: string,
  opts: { force?: boolean } = {},
): Route {
  const route = load(slug);
  findTack(route, tackId);

  const id = normalizeTackId(tackId);
  const dependents = route.tacks.filter((t) =>
    t.id !== id && t.depends_on?.includes(id),
  );
  // Other routes reach this tack by its qualified form [DEPENDS-06].
  const foreign = inboundRefs(slug, id);

  if ((dependents.length > 0 || foreign.length > 0) && !opts.force) {
    const local = dependents.map((t) => t.id);
    const remote = foreign.map((r) => `${r.slug}/${r.from}`);
    throw new Error(
      `Cannot remove ${id}: depended on by ${[...local, ...remote].join(", ")}. ` +
        `Pass --force to strip references.`,
    );
  }

  for (const dep of dependents) {
    dep.depends_on = dep.depends_on!.filter((entry) => entry !== id);
    if (dep.depends_on.length === 0) delete dep.depends_on;
  }

  route.tacks = route.tacks.filter((t) => t.id !== id);
  save(route);
  for (const other of stripInbound(foreign)) writeRoute(other);
  return route;
}

// Drop the named inbound edges from the routes that carry them, returning those
// routes for the caller to write once its own change has landed.
function stripInbound(refs: InboundRef[]): Route[] {
  const touched = new Map<string, Route>();
  for (const ref of refs) {
    if (!touched.has(ref.slug)) touched.set(ref.slug, load(ref.slug));
    const other = touched.get(ref.slug)!;
    const t = other.tacks.find((x) => x.id === ref.from);
    if (!t?.depends_on) continue;
    t.depends_on = t.depends_on.filter((entry) => entry !== ref.dependsOn);
    if (t.depends_on.length === 0) delete t.depends_on;
    other.updated_at = now();
  }
  return [...touched.values()];
}
