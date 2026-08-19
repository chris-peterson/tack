import { execFileSync } from "node:child_process";
import * as route from "./route.js";
// A GitLab MR reached through the REST API rather than `glab mr view`, which
// takes an id plus a repo rather than the URL we hold. The project path is
// everything between the host and the `/-/` separator, so a group-nested
// project survives.
function gitlabRef(url) {
    const m = url.match(/^https:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/);
    return m ? { host: m[1], project: m[2], iid: m[3] } : null;
}
function githubPr(url) {
    return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url);
}
function run(cmd, args, url) {
    try {
        return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    }
    catch (e) {
        const err = e;
        if (err.code === "ENOENT") {
            throw new Error(`reconcile needs the ${cmd} CLI on PATH to read ${url}`);
        }
        throw new Error(`${cmd} failed for ${url}: ${(err.stderr || err.message).trim()}`);
    }
}
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
