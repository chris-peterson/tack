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
// The change request an open tack is waiting on — the only thing a forge can
// answer for. That is its deliverable, or, with no deliverable, its one PR/MR
// link: an open CR is recorded as a link until it merges, and `markDone`
// promotes exactly that link. Issues and commits don't merge, and a tack with
// several PR/MR links is left for the user to say which one shipped.
function changeRequest(t) {
    if (!route.isOpen(t))
        return undefined;
    if (t.deliverable) {
        return route.isPrOrMrUrl(t.deliverable.url) ? t.deliverable.url : undefined;
    }
    const prLinks = (t.links ?? []).filter((l) => route.isPrOrMrUrl(l.url));
    return prLinks.length === 1 ? prLinks[0].url : undefined;
}
export function reconcile(opts = {}) {
    const probe = opts.probe ?? mergeState;
    const routes = opts.slug ? [route.load(opts.slug)] : route.scanAll();
    const closed = [];
    for (const r of routes) {
        for (const t of r.tacks) {
            const url = changeRequest(t);
            if (!url)
                continue;
            const state = probe(url);
            if (!state.merged)
                continue;
            const c = {
                slug: r.slug,
                tackId: t.id,
                summary: t.summary,
                url,
                mergedAt: state.mergedAt,
            };
            // The merge time, not now(): the work finished when the change landed,
            // and reconcile may be catching up days later.
            if (!opts.dryRun)
                route.markDone(r.slug, t.id, { at: state.mergedAt });
            closed.push(c);
            // Reported as each close is written, so a probe that throws later in the
            // sweep can't leave a written close unreported.
            opts.onClose?.(c);
        }
    }
    return closed;
}
