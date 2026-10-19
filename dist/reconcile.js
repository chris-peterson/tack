import { githubPr, gitlabRef, run } from "./forge.js";
import * as route from "./route.js";
export function mergeState(url) {
    if (githubPr(url)) {
        const out = run("gh", ["pr", "view", url, "--json", "state,mergedAt"], url);
        const json = JSON.parse(out);
        return json.state === "MERGED" && json.mergedAt
            ? { merged: true, mergedAt: json.mergedAt }
            : { merged: false };
    }
    const gl = gitlabRef(url);
    if (gl) {
        const path = `projects/${encodeURIComponent(gl.project)}/merge_requests/${gl.iid}`;
        const out = run("glab", ["api", "--hostname", gl.host, path], url);
        const json = JSON.parse(out);
        return json.state === "merged" && json.merged_at
            ? { merged: true, mergedAt: json.merged_at }
            : { merged: false };
    }
    throw new Error(`reconcile does not know how to read ${url}`);
}
// Open tacks whose deliverable is a change request — the only ones a forge can
// answer for. A tack without a deliverable, or one pointing at an issue or a
// commit, is left alone: neither merges.
function candidates(r) {
    return r.tacks.filter((t) => route.isOpen(t) && t.deliverable && route.isPrOrMrUrl(t.deliverable.url));
}
export function reconcile(opts = {}) {
    const probe = opts.probe ?? mergeState;
    const routes = opts.slug ? [route.load(opts.slug)] : route.scanAll();
    const closed = [];
    for (const r of routes) {
        for (const t of candidates(r)) {
            const state = probe(t.deliverable.url);
            if (!state.merged)
                continue;
            closed.push({
                slug: r.slug,
                tackId: t.id,
                summary: t.summary,
                url: t.deliverable.url,
                mergedAt: state.mergedAt,
            });
            // The merge time, not now(): the work finished when the change landed,
            // and reconcile may be catching up days later.
            if (!opts.dryRun)
                route.markDone(r.slug, t.id, { at: state.mergedAt });
        }
    }
    return closed;
}
