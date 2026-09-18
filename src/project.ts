import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import * as route from "./route.js";
import type { Deliverable, Link, Route, Session, Tack, TackStatus } from "./types.js";

// The git-backed store holds what no forge can re-answer: which artifacts
// belong to one piece of work, and the phrasing a person gave it. Everything
// else about an artifact is derived, so filling the user-local store from it
// needs no network, and `tack reconcile` remains the one door to a forge.

const STORE_ENV = "TACK_STORE";

// A url is a bare string when its label follows from the url, and a mapping
// when the label was authored and could not be re-derived.
type UrlEntry = string | { url: string; label?: string };

interface StoreTack {
  id: string;
  summary: string;
  status?: TackStatus;
  done_at?: string;
  depends_on?: string[];
  deliverable?: string;
  urls?: UrlEntry[];
}

interface StoreRoute {
  slug: string;
  id: string;
  created_at: string;
  group?: string;
  title?: string;
  description?: string;
  sessions?: Session[];
  tacks?: StoreTack[];
}

export interface ProjectReport {
  routes: number;
  tacks: number;
  created: string[];
  updated: string[];
  unchanged: number;
  carried: number;
}

const CHANGE_REQUEST = /\/(?:pull|merge_requests)\/\d+/;
const COMMIT = /\/commit\/[0-9a-f]{7,40}/i;

export function resolveStore(explicit?: string): string {
  const root = explicit ?? process.env[STORE_ENV];
  if (!root) {
    throw new Error(
      `no store configured — pass --store <path> or set ${STORE_ENV}`,
    );
  }
  if (!existsSync(root)) throw new Error(`store not found: ${root}`);
  return root;
}

export function readStore(root: string): StoreRoute[] {
  const years = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => e.name)
    .sort();

  const out: StoreRoute[] = [];
  for (const year of years) {
    const dir = join(root, year, "routes");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
      const entry = parse(readFileSync(join(dir, file), "utf-8")) as StoreRoute;
      const stem = file.slice(0, -".yaml".length);
      if (entry?.slug !== stem) {
        throw new Error(`${year}/routes/${file}: slug is "${entry?.slug}"`);
      }
      out.push(entry);
    }
  }
  return out;
}

function asLink(entry: UrlEntry): Link {
  if (typeof entry === "string") {
    return { label: route.deriveDeliverableLabel(entry), url: entry };
  }
  return { label: entry.label ?? route.deriveDeliverableLabel(entry.url), url: entry.url };
}

// Which url a tack delivers follows from its shape, so the store records it
// only where several change requests make that ambiguous.
function pickDeliverable(tack: StoreTack, links: Link[]): string | undefined {
  if (tack.deliverable) return tack.deliverable;
  const cr = links.filter((l) => CHANGE_REQUEST.test(l.url));
  if (cr.length === 1) return cr[0].url;
  if (cr.length > 1) return undefined;
  const commit = links.filter((l) => COMMIT.test(l.url));
  return commit.length === 1 ? commit[0].url : undefined;
}

function toTack(slug: string, stored: StoreTack, prior?: Tack): Tack {
  // A summary is the phrasing a person gave the work, so a store missing one
  // has nothing to project. Say which record, rather than failing later inside
  // the write with a type error.
  if (!stored.summary) {
    throw new Error(`${slug}/${stored.id ?? "?"}: store record has no summary`);
  }
  const links = (stored.urls ?? []).map(asLink);
  const deliverableUrl = pickDeliverable(stored, links);
  const deliverable = links.find((l) => l.url === deliverableUrl) as Deliverable | undefined;

  // Where a forge can re-establish completion, the store stays out of it and a
  // projection carries forward what is already known. Where it cannot -- a
  // dropped or blocked tack, or one delivered as a commit -- the store is the
  // only record, so it wins.
  const tack: Tack = {
    id: stored.id,
    summary: stored.summary,
    status: stored.status ?? prior?.status ?? "pending",
  };
  const doneAt = stored.status ? stored.done_at : prior?.done_at;
  if (doneAt) tack.done_at = String(doneAt);
  if (stored.depends_on?.length) tack.depends_on = [...stored.depends_on];
  if (deliverable) tack.deliverable = deliverable;

  const rest = links.filter((l) => l.url !== deliverableUrl);
  if (rest.length) tack.links = rest;
  return tack;
}

export function toRoute(stored: StoreRoute, prior?: Route): Route {
  const priorTacks = new Map((prior?.tacks ?? []).map((t) => [t.id, t]));
  const result: Route = {
    id: stored.id,
    slug: stored.slug,
    created_at: String(stored.created_at),
    updated_at: prior?.updated_at ?? String(stored.created_at),
    tacks: (stored.tacks ?? []).map((t) => toTack(stored.slug, t, priorTacks.get(t.id))),
  };
  if (stored.title) result.title = stored.title;
  if (stored.description) result.description = stored.description;
  if (stored.group) result.group = stored.group;
  if (stored.sessions?.length) result.sessions = stored.sessions;
  return result;
}

export function project(opts: { store?: string; dryRun?: boolean } = {}): ProjectReport {
  const root = resolveStore(opts.store);
  const stored = readStore(root);

  const report: ProjectReport = {
    routes: stored.length,
    tacks: 0,
    created: [],
    updated: [],
    unchanged: 0,
    carried: 0,
  };

  for (const entry of stored) {
    const exists = route.routeExists(entry.slug);
    const prior = exists ? route.load(entry.slug) : undefined;
    const next = toRoute(entry, prior);

    report.tacks += next.tacks.length;
    report.carried += next.tacks.filter((t) => t.status !== "pending").length;

    if (!exists) report.created.push(entry.slug);
    else if (JSON.stringify(prior) !== JSON.stringify(next)) report.updated.push(entry.slug);
    else report.unchanged += 1;

    if (!opts.dryRun && (!exists || JSON.stringify(prior) !== JSON.stringify(next))) {
      route.writeRoute(next);
    }
  }

  return report;
}
