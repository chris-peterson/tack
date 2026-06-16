import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import { validate } from "./schema.js";
import type { Link, Route, Tack, TackStatus, TodoItem } from "./types.js";

const TACK_HOME = process.env.TACK_HOME ?? join(homedir(), ".tack");
const TACK_DIR = join(TACK_HOME, "routes");
const PINS_FILE = join(TACK_HOME, "pins.yaml");

export function isOpen(t: Tack): boolean {
  return t.status !== "done" && t.status !== "dropped";
}

export function loadAll(): Route[] {
  ensureDir();
  const files = readdirSync(TACK_DIR).filter((f: string) => f.endsWith(".yaml"));
  return files.map((f: string) => load(f.replace(/\.yaml$/, "")));
}

function ensureDir(): void {
  if (!existsSync(TACK_DIR)) {
    mkdirSync(TACK_DIR, { recursive: true });
  }
}

function routePath(slug: string): string {
  return join(TACK_DIR, `${slug}.yaml`);
}

function now(): string {
  return new Date().toISOString();
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

export function load(slug: string): Route {
  const path = routePath(slug);
  if (!existsSync(path)) {
    throw new Error(`Route not found: ${slug}`);
  }

  const raw = readFileSync(path, "utf-8");
  const data = parse(raw);

  const result = validate(data);
  if (!result.valid) {
    throw new Error(`Invalid route file ${slug}.yaml:\n${result.errors.join("\n")}`);
  }

  return data as Route;
}

function save(route: Route): void {
  ensureDir();
  route.updated_at = now();

  const result = validate(route);
  if (!result.valid) {
    throw new Error(`Route validation failed:\n${result.errors.join("\n")}`);
  }

  writeFileSync(routePath(route.slug), stringify(route), "utf-8");
}

export function init(slug: string, opts: { group?: string } = {}): Route {
  ensureDir();
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
  return route;
}

export function list(): { slug: string; group?: string; total: number; open: number }[] {
  return loadAll().map((r) => ({
    slug: r.slug, group: r.group, total: r.tacks.length, open: r.tacks.filter(isOpen).length,
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

function nextTodoId(items: TodoItem[], prefix: string): string {
  if (items.length === 0) return `${prefix}1`;
  const max = Math.max(...items.map((item) => parseInt(item.id.slice(1), 10)));
  return `${prefix}${max + 1}`;
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

function findTodo(tack: Tack, todoId: string): { item: TodoItem; list: "before" | "after" } {
  const beforeItem = tack.before?.find((t) => t.id === todoId);
  if (beforeItem) return { item: beforeItem, list: "before" };

  const afterItem = tack.after?.find((t) => t.id === todoId);
  if (afterItem) return { item: afterItem, list: "after" };

  throw new Error(`Todo not found: ${todoId} in tack ${tack.id}`);
}

function checkDependencies(route: Route, dependsOn: string[]): void {
  for (const depId of dependsOn) {
    const dep = route.tacks.find((t) => t.id === depId);
    if (!dep) {
      throw new Error(`Dependency not found: ${depId}`);
    }
  }
}

function detectCycle(route: Route, tackId: string, dependsOn: string[]): void {
  const visited = new Set<string>();

  function walk(id: string): void {
    if (id === tackId) {
      throw new Error(`Circular dependency detected involving ${tackId}`);
    }
    if (visited.has(id)) return;
    visited.add(id);
    const tack = route.tacks.find((t) => t.id === id);
    if (tack?.depends_on) {
      for (const depId of tack.depends_on) {
        walk(depId);
      }
    }
  }

  for (const depId of dependsOn) {
    walk(depId);
  }
}

export function addTack(
  slug: string,
  summary: string,
  opts: {
    dependsOn?: string[];
    done?: boolean;
    doneAt?: string;
    deliverable?: { label: string; url: string };
  } = {}
): Tack {
  const route = load(slug);
  const id = nextTackId(route);

  const dependsOn = opts.dependsOn?.map(normalizeTackId);
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

  route.tacks.push(tack);
  save(route);
  return tack;
}

export function markDone(
  slug: string,
  tackId: string,
  opts: { at?: string } = {},
): { tack: Tack; pendingTodo: string[]; ambiguousDeliverable: Link[] } {
  const route = load(slug);
  const tack = findTack(route, tackId);

  tack.status = "done";
  if (opts.at) {
    tack.done_at = normalizeTimestamp(opts.at);
  } else if (!tack.done_at) {
    tack.done_at = now();
  }

  let ambiguousDeliverable: Link[] = [];
  if (!tack.deliverable && tack.links?.length) {
    const prLinks = tack.links.filter((l) => isPrOrMrUrl(l.url));
    if (prLinks.length === 1) {
      const prLink = prLinks[0];
      tack.deliverable = { label: prLink.label, url: prLink.url };
      tack.links = tack.links.filter((l) => l !== prLink);
      if (tack.links.length === 0) delete tack.links;
    } else if (prLinks.length > 1) {
      ambiguousDeliverable = prLinks.map((l) => ({ label: l.label, url: l.url }));
    }
  }

  const pendingTodo = (tack.after ?? [])
    .filter((a) => !a.done)
    .map((a) => a.text);

  save(route);
  return { tack, pendingTodo, ambiguousDeliverable };
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
    const unmet = tack.depends_on.filter((depId) => {
      const dep = route.tacks.find((t) => t.id === depId);
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
  depId = normalizeTackId(depId);

  if (tack.id === depId) {
    throw new Error(`Cannot depend on self: ${tack.id}`);
  }
  findTack(route, depId);

  if (tack.depends_on?.includes(depId)) {
    return tack;
  }

  const proposed = [...(tack.depends_on ?? []), depId];
  detectCycle(route, tackId, proposed);

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
  depId = normalizeTackId(depId);

  if (!tack.depends_on?.includes(depId)) {
    throw new Error(
      `${tack.id} does not depend on ${depId} in route ${slug}`,
    );
  }

  tack.depends_on = tack.depends_on.filter((id) => id !== depId);
  if (tack.depends_on.length === 0) delete tack.depends_on;

  save(route);
  return tack;
}

export function rename(oldSlug: string, newSlug: string): Route {
  if (oldSlug === newSlug) {
    throw new Error(`Old and new slug are the same: ${oldSlug}`);
  }

  const oldPath = routePath(oldSlug);
  const newPath = routePath(newSlug);

  if (!existsSync(oldPath)) {
    throw new Error(`Route not found: ${oldSlug}`);
  }
  if (existsSync(newPath)) {
    throw new Error(`Route already exists: ${newSlug}`);
  }

  const all = loadAll();
  const referers = all
    .filter((r) => r.slug !== oldSlug && r.depends_on?.includes(oldSlug))
    .map((r) => r.slug);
  if (referers.length > 0) {
    throw new Error(
      `Cannot rename ${oldSlug}: referenced by ${referers.join(", ")}. ` +
        `Remove the reference from depends_on first.`,
    );
  }

  const route = all.find((r) => r.slug === oldSlug)!;
  route.slug = newSlug;
  route.updated_at = now();

  const result = validate(route);
  if (!result.valid) {
    throw new Error(`Route validation failed:\n${result.errors.join("\n")}`);
  }

  writeFileSync(oldPath, stringify(route), "utf-8");
  renameSync(oldPath, newPath);
  return route;
}

export function setDeliverable(
  slug: string,
  tackId: string,
  label: string,
  url: string,
  opts: { force?: boolean } = {},
): Tack {
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
  return tack;
}

export function addBefore(slug: string, tackId: string, text: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  if (!tack.before) tack.before = [];
  const id = nextTodoId(tack.before, "b");
  tack.before.push({ id, text, done: false });
  save(route);
  return tack;
}

export function addAfter(slug: string, tackId: string, text: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  if (!tack.after) tack.after = [];
  const id = nextTodoId(tack.after, "a");
  tack.after.push({ id, text, done: false });
  save(route);
  return tack;
}

export function completeTodo(slug: string, tackId: string, todoId: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  const { item } = findTodo(tack, todoId);
  item.done = true;
  if (!item.done_at) item.done_at = now();
  save(route);
  return tack;
}

export function dropTodo(slug: string, tackId: string, todoId: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  const { list } = findTodo(tack, todoId);
  if (list === "before") {
    tack.before = tack.before!.filter((t) => t.id !== todoId);
  } else {
    tack.after = tack.after!.filter((t) => t.id !== todoId);
  }
  save(route);
  return tack;
}

type ChangeRefKind = "pr" | "mr" | "issue" | "commit";
interface ChangeRef {
  repo: string;
  // PR/MR/issue number, or the abbreviated (7-char) sha for a commit.
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
  const gl = url.match(
    /^https:\/\/gitlab\.[^/]*\/.*?\/([^/]+)\/-\/(merge_requests|issues)\/(\d+)/,
  );
  if (gl) {
    return { repo: gl[1], ref: gl[3], kind: gl[2] === "merge_requests" ? "mr" : "issue" };
  }
  const glCommit = url.match(
    /^https:\/\/gitlab\.[^/]*\/.*?\/([^/]+)\/-\/commit\/([0-9a-f]+)/i,
  );
  if (glCommit) {
    return { repo: glCommit[1], ref: glCommit[2].slice(0, 7), kind: "commit" };
  }
  return null;
}

function isPrOrMrUrl(url: string): boolean {
  const ref = parseChangeRefUrl(url);
  return ref !== null && (ref.kind === "pr" || ref.kind === "mr");
}

// Canonical forge notation attaches a kind-specific sigil to the repo:
// `repo#42` for a PR/issue, `repo!99` for an MR, `repo@<sha7>` for a commit.
const CHANGE_REF_SIGIL: Record<ChangeRefKind, string> = {
  pr: "#",
  issue: "#",
  mr: "!",
  commit: "@",
};

export function deriveDeliverableLabel(url: string): string {
  const ref = parseChangeRefUrl(url);
  if (!ref) return url;
  return `${ref.repo}${CHANGE_REF_SIGIL[ref.kind]}${ref.ref}`;
}

export function addLink(slug: string, tackId: string, label: string, url: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);

  if (tack.deliverable?.url === url) return tack;
  if (tack.links?.some((l) => l.url === url)) return tack;

  if (!tack.links) tack.links = [];
  tack.links.push({ label, url });

  save(route);
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

  if (source.before?.length) {
    if (!target.before) target.before = [];
    for (const item of source.before) {
      const id = nextTodoId(target.before, "b");
      target.before.push({ ...item, id });
    }
  }

  if (source.after?.length) {
    if (!target.after) target.after = [];
    for (const item of source.after) {
      const id = nextTodoId(target.after, "a");
      target.after.push({ ...item, id });
    }
  }

  if (source.links?.length) {
    if (!target.links) target.links = [];
    for (const link of source.links) {
      target.links.push({ ...link });
    }
  }

  route.tacks = route.tacks.filter((t) => t.id !== source.id);

  save(route);
  return target;
}

export function recordSession(slug: string, sessionId: string, tackId?: string): Route {
  const route = load(slug);
  if (!route.sessions) route.sessions = [];
  let session = route.sessions.find((s) => s.id === sessionId);
  if (!session) {
    session = { id: sessionId, started_at: now() };
    route.sessions.push(session);
  }
  if (tackId !== undefined) {
    // findTack validates existence and normalizes a bare `<N>` to `t<N>`.
    const id = findTack(route, tackId).id;
    if (!session.tacks) session.tacks = [];
    // Re-binding an already-listed tack moves it to the end: the last entry
    // is the session's current focus, so a pivot back to an earlier tack
    // makes it current again rather than leaving a stale tail.
    const idx = session.tacks.indexOf(id);
    if (idx !== -1) session.tacks.splice(idx, 1);
    session.tacks.push(id);
  }
  save(route);
  return route;
}

export function recent(opts: { count?: number; since?: string } = {}): { slug: string; group?: string; updated_at: string; total: number; open: number }[] {
  let routes = loadAll().map((r) => ({
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

export function find(url: string): FindMatch[] {
  const matches: FindMatch[] = [];

  for (const r of loadAll()) {
    const routeOpen = r.tacks.filter(isOpen).length;
    for (const tack of r.tacks) {
      const base = { slug: r.slug, group: r.group, routeTotal: r.tacks.length, routeOpen, tackId: tack.id, summary: tack.summary, status: tack.status, done_at: tack.done_at };
      if (tack.deliverable?.url === url) {
        matches.push({ ...base, match: "deliverable", label: tack.deliverable.label, url: tack.deliverable.url });
      }
      if (tack.links) {
        for (const link of tack.links) {
          if (link.url === url) {
            matches.push({ ...base, match: "link", label: link.label, url: link.url });
          }
        }
      }
    }
  }

  return matches;
}

export function remove(slug: string): void {
  const path = routePath(slug);
  if (!existsSync(path)) {
    throw new Error(`Route not found: ${slug}`);
  }
  unlinkSync(path);
}

export interface Pin {
  slug: string;
  pinned_at: string;
  session_id?: string;
}

// Pins live in ~/.tack/pins.yaml (keyed by absolute cwd), never in the
// project tree — a state file at the cwd is one `git add .` away from being
// committed to someone else's repo.
function readPins(): Record<string, Pin> {
  if (!existsSync(PINS_FILE)) return {};
  return (parse(readFileSync(PINS_FILE, "utf-8")) ?? {}) as Record<string, Pin>;
}

function writePins(pins: Record<string, Pin>): void {
  if (!existsSync(TACK_HOME)) {
    mkdirSync(TACK_HOME, { recursive: true });
  }
  writeFileSync(PINS_FILE, stringify(pins), "utf-8");
}

export function readPin(cwd: string = process.cwd()): Pin | null {
  return readPins()[cwd] ?? null;
}

export function writePin(slug: string, cwd: string = process.cwd()): Pin {
  if (!existsSync(routePath(slug))) {
    throw new Error(`Route not found: ${slug}`);
  }
  const pin: Pin = {
    slug,
    pinned_at: now(),
  };
  const sessionId = process.env.CLAUDE_SESSION_ID;
  if (sessionId) pin.session_id = sessionId;
  const pins = readPins();
  pins[cwd] = pin;
  writePins(pins);
  return pin;
}

export function deletePin(cwd: string = process.cwd()): boolean {
  const pins = readPins();
  if (!(cwd in pins)) return false;
  delete pins[cwd];
  writePins(pins);
  return true;
}

export interface PinEntry extends Pin {
  path: string;
  dangling: boolean;
  idle: boolean;
}

export function listPins(): PinEntry[] {
  const pins = readPins();
  return Object.entries(pins)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, pin]) => {
      const dangling = !existsSync(routePath(pin.slug));
      const idle = !dangling && !load(pin.slug).tacks.some(isOpen);
      return { path, ...pin, dangling, idle };
    });
}

export interface PruneResult {
  path: string;
  slug: string;
  reason: "dangling route" | "missing directory";
}

export function prunePins(): PruneResult[] {
  const pins = readPins();
  const removed: PruneResult[] = [];
  for (const [path, pin] of Object.entries(pins)) {
    let reason: PruneResult["reason"] | null = null;
    if (!existsSync(routePath(pin.slug))) reason = "dangling route";
    else if (!existsSync(path)) reason = "missing directory";
    if (reason) {
      removed.push({ path, slug: pin.slug, reason });
      delete pins[path];
    }
  }
  if (removed.length > 0) writePins(pins);
  return removed;
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
  findTack(srcRoute, srcTackId);

  const movingIds = new Set<string>([srcTackId]);
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

  const outgoing: { from: string; to: string }[] = [];
  for (const t of moving) {
    for (const dep of t.depends_on ?? []) {
      if (!movingIds.has(dep)) outgoing.push({ from: t.id, to: dep });
    }
  }
  const incoming: { from: string; to: string }[] = [];
  for (const t of staying) {
    for (const dep of t.depends_on ?? []) {
      if (movingIds.has(dep)) incoming.push({ from: t.id, to: dep });
    }
  }

  if (outgoing.length > 0 || incoming.length > 0) {
    const lines: string[] = [];
    if (outgoing.length > 0) {
      lines.push("  outgoing (moving → staying):");
      for (const e of outgoing) lines.push(`    ${e.from} → ${e.to}`);
    }
    if (incoming.length > 0) {
      lines.push("  incoming (staying → moving):");
      for (const e of incoming) lines.push(`    ${e.from} → ${e.to}`);
    }
    const includeHint =
      !opts.includeDependents && incoming.length > 0 && outgoing.length === 0
        ? `  - tack move ${srcSlug}/${srcTackId} ${dstSlug} --include-dependents   move the dependent chain together\n`
        : "";
    throw new Error(
      `Cannot move ${srcSlug}/${srcTackId} to ${dstSlug}: depends_on edges cross the route boundary. ` +
        `Tack IDs are route-local; cross-route references are not supported.\n` +
        lines.join("\n") +
        `\nResolve by:\n` +
        includeHint +
        `  - tack depends rm <slug> <tack-id> <dep-id>                       break each edge\n`,
    );
  }

  let nextN = nextTackNumber(dstRoute);
  const idMap = new Map<string, string>();
  for (const t of moving) idMap.set(t.id, `t${nextN++}`);

  const movedReport: { srcId: string; dstId: string; summary: string }[] = [];
  for (const src of moving) {
    const dst: Tack = { ...structuredClone(src), id: idMap.get(src.id)! };
    if (src.depends_on?.length) {
      dst.depends_on = src.depends_on.map((dep) => idMap.get(dep)!);
    }

    dstRoute.tacks.push(dst);
    movedReport.push({ srcId: src.id, dstId: dst.id, summary: src.summary });
  }

  srcRoute.tacks = staying;

  save(dstRoute);
  save(srcRoute);

  return { srcRoute, dstRoute, moved: movedReport };
}

export function removeTack(
  slug: string,
  tackId: string,
  opts: { force?: boolean } = {},
): Route {
  const route = load(slug);
  findTack(route, tackId);

  const dependents = route.tacks.filter((t) =>
    t.id !== tackId && t.depends_on?.includes(tackId),
  );

  if (dependents.length > 0 && !opts.force) {
    const depIds = dependents.map((t) => t.id).join(", ");
    throw new Error(
      `Cannot remove ${tackId}: depended on by ${depIds}. Pass --force to strip references.`,
    );
  }

  for (const dep of dependents) {
    dep.depends_on = dep.depends_on!.filter((id) => id !== tackId);
    if (dep.depends_on.length === 0) delete dep.depends_on;
  }

  route.tacks = route.tacks.filter((t) => t.id !== tackId);
  save(route);
  return route;
}
