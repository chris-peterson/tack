import { execFileSync } from "node:child_process";
import * as route from "./route.js";
import type { Route, Tack } from "./types.js";

// The only part of tack that talks to a network. Every other command reads and
// writes local files, and the Anti-Requirements keep it that way — asking a
// forge whether a change request merged is this command's whole job, so the
// dependency lives here rather than leaking into `status` or `done`.

export interface MergeState {
  merged: boolean;
  mergedAt?: string;
}

export interface Reconciled {
  slug: string;
  tackId: string;
  summary: string;
  url: string;
  mergedAt: string;
}

// A GitLab MR reached through the REST API rather than `glab mr view`, which
// takes an id plus a repo rather than the URL we hold. The project path is
// everything between the host and the `/-/` separator, so a group-nested
// project survives.
function gitlabRef(url: string): { host: string; project: string; iid: string } | null {
  const m = url.match(/^https:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/);
  return m ? { host: m[1], project: m[2], iid: m[3] } : null;
}

function githubPr(url: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url);
}

function run(cmd: string, args: string[], url: string): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { code?: string; stderr?: string; message: string };
    if (err.code === "ENOENT") {
      throw new Error(`reconcile needs the ${cmd} CLI on PATH to read ${url}`);
    }
    throw new Error(`${cmd} failed for ${url}: ${(err.stderr || err.message).trim()}`);
  }
}

export function mergeState(url: string): MergeState {
  if (githubPr(url)) {
    const out = run("gh", ["pr", "view", url, "--json", "state,mergedAt"], url);
    const json = JSON.parse(out) as { state: string; mergedAt: string | null };
    return json.state === "MERGED" && json.mergedAt
      ? { merged: true, mergedAt: json.mergedAt }
      : { merged: false };
  }

  const gl = gitlabRef(url);
  if (gl) {
    const path = `projects/${encodeURIComponent(gl.project)}/merge_requests/${gl.iid}`;
    const out = run("glab", ["api", "--hostname", gl.host, path], url);
    const json = JSON.parse(out) as { state: string; merged_at: string | null };
    return json.state === "merged" && json.merged_at
      ? { merged: true, mergedAt: json.merged_at }
      : { merged: false };
  }

  throw new Error(`reconcile does not know how to read ${url}`);
}

// Open tacks whose deliverable is a change request — the only ones a forge can
// answer for. A tack without a deliverable, or one pointing at an issue or a
// commit, is left alone: neither merges.
function candidates(r: Route): Tack[] {
  return r.tacks.filter(
    (t) => route.isOpen(t) && t.deliverable && route.isPrOrMrUrl(t.deliverable.url),
  );
}

export function reconcile(
  opts: { slug?: string; dryRun?: boolean; probe?: (url: string) => MergeState } = {},
): Reconciled[] {
  const probe = opts.probe ?? mergeState;
  const routes = opts.slug ? [route.load(opts.slug)] : route.loadAll();
  const closed: Reconciled[] = [];

  for (const r of routes) {
    for (const t of candidates(r)) {
      const state = probe(t.deliverable!.url);
      if (!state.merged) continue;
      closed.push({
        slug: r.slug,
        tackId: t.id,
        summary: t.summary,
        url: t.deliverable!.url,
        mergedAt: state.mergedAt!,
      });
      // The merge time, not now(): the work finished when the change landed,
      // and reconcile may be catching up days later.
      if (!opts.dryRun) route.markDone(r.slug, t.id, { at: state.mergedAt });
    }
  }

  return closed;
}
