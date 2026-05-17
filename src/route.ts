import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import { validate } from "./schema.js";
import type { Route, Tack, TodoItem } from "./types.js";

const TACK_DIR = join(process.env.TACK_HOME ?? join(homedir(), ".tack"), "routes");

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

function nextTackId(route: Route): string {
  if (route.tacks.length === 0) return "t1";
  const max = Math.max(...route.tacks.map((t) => parseInt(t.id.slice(1), 10)));
  return `t${max + 1}`;
}

function nextTodoId(items: TodoItem[], prefix: string): string {
  if (items.length === 0) return `${prefix}1`;
  const max = Math.max(...items.map((item) => parseInt(item.id.slice(1), 10)));
  return `${prefix}${max + 1}`;
}

function findTack(route: Route, tackId: string): Tack {
  const tack = route.tacks.find((t) => t.id === tackId);
  if (!tack) {
    throw new Error(`Tack not found: ${tackId} in route ${route.slug}`);
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

  if (opts.dependsOn?.length) {
    checkDependencies(route, opts.dependsOn);
    detectCycle(route, id, opts.dependsOn);
  }

  const tack: Tack = {
    id,
    summary,
    status: opts.done ? "done" : "pending",
  };

  if (opts.dependsOn?.length) tack.depends_on = opts.dependsOn;
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
): { tack: Tack; pendingTodo: string[] } {
  const route = load(slug);
  const tack = findTack(route, tackId);

  tack.status = "done";
  if (opts.at) {
    tack.done_at = normalizeTimestamp(opts.at);
  } else if (!tack.done_at) {
    tack.done_at = now();
  }

  if (!tack.deliverable && tack.links?.length) {
    const prLink = tack.links.find((l) => isPrOrMrUrl(l.url));
    if (prLink) {
      tack.deliverable = { label: prLink.label, url: prLink.url };
      tack.links = tack.links.filter((l) => l !== prLink);
      if (tack.links.length === 0) delete tack.links;
    }
  }

  const pendingTodo = (tack.after ?? [])
    .filter((a) => !a.done)
    .map((a) => a.text);

  save(route);
  return { tack, pendingTodo };
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
      throw new Error(`Cannot start ${tackId}: unmet dependencies: ${unmet.join(", ")}`);
    }
  }

  tack.status = "in_progress";
  save(route);
  return tack;
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

type ChangeRefKind = "pr" | "mr" | "issue";
interface ChangeRef {
  repo: string;
  number: string;
  kind: ChangeRefKind;
}

function parseChangeRefUrl(url: string): ChangeRef | null {
  const gh = url.match(
    /^https:\/\/github\.com\/[^/]+\/([^/]+)\/(pull|issues)\/(\d+)/,
  );
  if (gh) {
    return { repo: gh[1], number: gh[3], kind: gh[2] === "pull" ? "pr" : "issue" };
  }
  const gl = url.match(
    /^https:\/\/gitlab\.[^/]*\/.*?\/([^/]+)\/-\/(merge_requests|issues)\/(\d+)/,
  );
  if (gl) {
    return { repo: gl[1], number: gl[3], kind: gl[2] === "merge_requests" ? "mr" : "issue" };
  }
  return null;
}

function isPrOrMrUrl(url: string): boolean {
  const ref = parseChangeRefUrl(url);
  return ref !== null && (ref.kind === "pr" || ref.kind === "mr");
}

export function deriveDeliverableLabel(url: string): string {
  const ref = parseChangeRefUrl(url);
  if (!ref) return url;
  const sigil = ref.kind === "mr" ? "!" : "#";
  return `${ref.repo} ${sigil}${ref.number}`;
}

export function addLink(slug: string, tackId: string, label: string, url: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);

  if (tack.deliverable?.url === url) return tack;
  if (tack.links?.some((l) => l.url === url)) return tack;

  if (!tack.deliverable && isPrOrMrUrl(url)) {
    tack.deliverable = { label, url };
  } else {
    if (!tack.links) tack.links = [];
    tack.links.push({ label, url });
  }

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

  source.status = "dropped";

  save(route);
  return target;
}

export function recordSession(slug: string, sessionId: string): Route {
  const route = load(slug);
  if (!route.sessions) route.sessions = [];
  if (!route.sessions.some((s) => s.id === sessionId)) {
    route.sessions.push({ id: sessionId, started_at: now() });
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

function pinPath(cwd: string): string {
  return join(cwd, ".tack");
}

export function readPin(cwd: string = process.cwd()): Pin | null {
  const path = pinPath(cwd);
  if (!existsSync(path)) return null;
  const data = parse(readFileSync(path, "utf-8")) as Pin;
  return data;
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
  writeFileSync(pinPath(cwd), stringify(pin), "utf-8");
  return pin;
}

export function deletePin(cwd: string = process.cwd()): boolean {
  const path = pinPath(cwd);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
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
