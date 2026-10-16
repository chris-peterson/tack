// Stats for a route, gathered when asked for and never stored ([SERVE-18]): what
// the sessions that drove its tacks spent, from their transcripts, and the size
// and timing of each change request or commit it delivered, from the forge.
import * as sessions from "./sessions.js";
import { deliverableStats, hasStats, type DeliverableStats } from "./forge.js";
import { sessionUsage, type SessionUsage } from "./usage.js";
import type { Route } from "./types.js";

export interface SessionStats {
  id: string;
  /** The tacks this session drove on the route being described. */
  tacks: string[];
  /** Other routes it drove tacks on: its whole usage counts toward each. */
  elsewhere: string[];
  /** Null when no transcript is on this machine for it. */
  usage: SessionUsage | null;
}

export interface ChangeEntry {
  url: string;
  label: string;
  stats?: DeliverableStats;
  error?: string;
}

export interface TackStats {
  id: string;
  change?: ChangeEntry;
  sessions: string[];
}

export interface RouteStats {
  slug: string;
  sessions: SessionStats[];
  tacks: TackStats[];
}

export type Probe = (url: string) => Promise<DeliverableStats>;

export const OPEN_CHANGE_TTL_MS = 60_000;

// The forge is most of a stats request's wait. A commit, and a merged or closed
// change request, never change again, so they are kept for the life of the
// process; an open change request is re-asked after a minute. Requests that arrive
// together share one call, and a failure is not kept, so the next request asks
// again.
export function cachedProbe(probe: Probe, openTtlMs = OPEN_CHANGE_TTL_MS, now: () => number = Date.now): Probe {
  const cache = new Map<string, { at: number; value: Promise<DeliverableStats>; settled: boolean }>();
  return (url) => {
    const hit = cache.get(url);
    if (hit && (hit.settled || now() - hit.at < openTtlMs)) return hit.value;
    const entry = { at: now(), value: probe(url), settled: false };
    cache.set(url, entry);
    entry.value.then(
      (s) => { entry.settled = s.kind === "commit" || s.state === "merged" || s.state === "closed"; },
      () => { if (cache.get(url) === entry) cache.delete(url); },
    );
    return entry.value;
  };
}

// Forge CLIs are separate processes; a route with dozens of deliverables would
// otherwise fork them all at once.
const FORGE_CONCURRENCY = 6;

async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function routeStats(r: Route, probe: Probe = deliverableStats): Promise<RouteStats> {
  const drove = sessions
    .onRoute(r.slug)
    .map((s) => ({ s, here: sessions.tacksOn(s.id, r.slug) }))
    .filter(({ here }) => here.length > 0);

  const sessionStats: SessionStats[] = drove.map(({ s, here }) => ({
    id: s.id,
    tacks: here,
    elsewhere: [...new Set((s.tacks ?? []).map((ref) => ref.slice(0, ref.lastIndexOf("/"))))].filter(
      (slug) => slug !== r.slug,
    ),
    usage: sessionUsage(s.id),
  }));

  const tacks = await pooled(r.tacks, FORGE_CONCURRENCY, async (t): Promise<TackStats> => {
    const ids = sessionStats.filter((s) => s.tacks.includes(t.id)).map((s) => s.id);
    const d = t.deliverable;
    if (!d || !hasStats(d.url)) return { id: t.id, sessions: ids };
    try {
      return { id: t.id, sessions: ids, change: { url: d.url, label: d.label, stats: await probe(d.url) } };
    } catch (e) {
      return { id: t.id, sessions: ids, change: { url: d.url, label: d.label, error: (e as Error).message } };
    }
  });

  return { slug: r.slug, sessions: sessionStats, tacks };
}
