import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import { validate } from "./schema.js";
import type { Route, RouteOrigin, Tack, TodoItem } from "./types.js";

const TACK_DIR = join(process.env.TACK_HOME ?? join(homedir(), ".tack"), "routes");

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
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

export function init(slug: string, opts: { origin?: RouteOrigin } = {}): Route {
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

  if (opts.origin) route.origin = opts.origin;

  save(route);
  return route;
}

export function list(): { slug: string; origin: string; total: number; open: number }[] {
  ensureDir();
  const files = readdirSync(TACK_DIR).filter((f: string) => f.endsWith(".yaml"));

  return files.map((f: string) => {
    const slug = f.replace(/\.yaml$/, "");
    const route = load(slug);
    const open = route.tacks.filter((t) => t.status !== "done" && t.status !== "dropped").length;
    return { slug, origin: route.origin ?? "planned", total: route.tacks.length, open };
  });
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
  opts: { project?: string; dependsOn?: string[] } = {}
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
    status: "pending",
  };

  if (opts.project) tack.project = opts.project;
  if (opts.dependsOn?.length) tack.depends_on = opts.dependsOn;

  route.tacks.push(tack);
  save(route);
  return tack;
}

export function markDone(slug: string, tackId: string): { tack: Tack; pendingTodo: string[] } {
  const route = load(slug);
  const tack = findTack(route, tackId);

  tack.status = "done";
  if (!tack.done_at) tack.done_at = today();

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

export function setDeliverable(slug: string, tackId: string, label: string, url: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
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
  if (!item.done_at) item.done_at = today();
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

export function addLink(slug: string, tackId: string, label: string, url: string): Tack {
  const route = load(slug);
  const tack = findTack(route, tackId);
  if (!tack.links) tack.links = [];
  tack.links.push({ label, url });
  save(route);
  return tack;
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

export function remove(slug: string): void {
  const path = routePath(slug);
  if (!existsSync(path)) {
    throw new Error(`Route not found: ${slug}`);
  }
  unlinkSync(path);
}
