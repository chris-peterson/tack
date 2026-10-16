import { execFile, execFileSync } from "node:child_process";
// Questions tack asks a forge, through the forge's own CLI (`gh`, `glab`) so
// the caller's existing authentication is inherited and no credential passes
// through tack ([CLI-56b]). Read-only: nothing here writes to a forge.
// A GitLab MR reached through the API rather than `glab mr view`, which takes an
// id plus a repo rather than the URL we hold. The project path is everything
// between the host and the `/-/` separator, so a group-nested project survives.
export function gitlabRef(url) {
    const m = url.match(/^https:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/);
    return m ? { host: m[1], project: m[2], iid: m[3] } : null;
}
export function githubPr(url) {
    return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url);
}
function githubCommit(url) {
    const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/commit\/([0-9a-f]+)/i);
    return m ? { repo: m[1], sha: m[2] } : null;
}
function gitlabCommit(url) {
    const m = url.match(/^https:\/\/([^/]+)\/(.+?)\/-\/commit\/([0-9a-f]+)/i);
    return m ? { host: m[1], project: m[2], sha: m[3] } : null;
}
/** Whether `deliverableStats` has a reader for this URL. */
export function hasStats(url) {
    return githubPr(url) || gitlabRef(url) !== null || githubCommit(url) !== null || gitlabCommit(url) !== null;
}
function failure(cmd, url, e) {
    const err = e;
    if (err.code === "ENOENT")
        return new Error(`needs the ${cmd} CLI on PATH to read ${url}`);
    return new Error(`${cmd} failed for ${url}: ${(err.stderr || err.message).trim()}`);
}
export function run(cmd, args, url) {
    try {
        return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    }
    catch (e) {
        throw failure(cmd, url, e);
    }
}
// The server asks while other requests wait, so it cannot block on a child the
// way the CLI does.
function runAsync(cmd, args, url) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { encoding: "utf-8" }, (e, stdout, stderr) => {
            if (e)
                reject(failure(cmd, url, Object.assign(e, { stderr })));
            else
                resolve(stdout);
        });
    });
}
const GITLAB_QUERY = `query($path: ID!, $iid: String!) { project(fullPath: $path) { mergeRequest(iid: $iid) {
  state draft createdAt mergedAt closedAt commitCount diffStatsSummary { additions deletions fileCount } } } }`;
export async function deliverableStats(url) {
    if (githubPr(url)) {
        const out = await runAsync("gh", ["pr", "view", url, "--json", "state,isDraft,createdAt,mergedAt,closedAt,additions,deletions,changedFiles,commits"], url);
        const j = JSON.parse(out);
        return {
            kind: "change_request",
            state: j.state === "MERGED" ? "merged" : j.state === "CLOSED" ? "closed" : j.isDraft ? "draft" : "open",
            opened_at: j.createdAt,
            ...(j.mergedAt ? { merged_at: j.mergedAt } : {}),
            ...(j.closedAt && j.state === "CLOSED" ? { closed_at: j.closedAt } : {}),
            additions: j.additions,
            deletions: j.deletions,
            files: j.changedFiles,
            commits: j.commits.length,
        };
    }
    const gl = gitlabRef(url);
    if (gl) {
        const query = async (project) => {
            const out = await runAsync("glab", ["api", "graphql", "--hostname", gl.host, "-f", `query=${GITLAB_QUERY}`, "-f", `path=${project}`, "-f", `iid=${gl.iid}`], url);
            return JSON.parse(out).data?.project?.mergeRequest;
        };
        // GraphQL looks a project up by its current path only. The REST API
        // follows a renamed or moved project from the path a URL was recorded with.
        let mr = await query(gl.project);
        if (!mr) {
            const current = JSON.parse(await runAsync("glab", ["api", "--hostname", gl.host, `projects/${encodeURIComponent(gl.project)}`], url)).path_with_namespace;
            if (current !== gl.project)
                mr = await query(current);
        }
        if (!mr)
            throw new Error(`glab found no merge request at ${url}`);
        return {
            kind: "change_request",
            state: mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : mr.draft ? "draft" : "open",
            opened_at: mr.createdAt,
            ...(mr.mergedAt ? { merged_at: mr.mergedAt } : {}),
            ...(mr.closedAt && mr.state === "closed" ? { closed_at: mr.closedAt } : {}),
            additions: mr.diffStatsSummary.additions,
            deletions: mr.diffStatsSummary.deletions,
            files: mr.diffStatsSummary.fileCount,
            commits: mr.commitCount,
        };
    }
    const ghc = githubCommit(url);
    const gone = (sha, host) => new Error(`${host} has no commit ${sha.slice(0, 7)}: a rebase or amend rewrote it, or it was never pushed`);
    if (ghc) {
        // One line per page of files (a page holds at most 300); the date and
        // line counts are the commit's and repeat on each.
        const out = await runAsync("gh", ["api", "--paginate", `repos/${ghc.repo}/commits/${ghc.sha}`, "--jq", "[.commit.committer.date, .stats.additions, .stats.deletions, (.files | length)] | @tsv"], url).catch((e) => {
            throw /No commit found|HTTP 422/.test(e.message) ? gone(ghc.sha, "GitHub") : e;
        });
        const pages = out.trim().split("\n").map((l) => l.split("\t"));
        return {
            kind: "commit",
            committed_at: pages[0][0],
            additions: Number(pages[0][1]),
            deletions: Number(pages[0][2]),
            files: pages.reduce((a, p) => a + Number(p[3]), 0),
        };
    }
    const glc = gitlabCommit(url);
    if (glc) {
        const base = `projects/${encodeURIComponent(glc.project)}/repository/commits/${glc.sha}`;
        const c = JSON.parse(await runAsync("glab", ["api", "--hostname", glc.host, base], url).catch((e) => {
            throw /Commit Not Found|HTTP 404/.test(e.message) ? gone(glc.sha, glc.host) : e;
        }));
        // The commit carries line counts but not a file count; its diff is one
        // entry per file, a page at a time.
        let files = 0;
        for (let page = 1;; page++) {
            const diff = JSON.parse(await runAsync("glab", ["api", "--hostname", glc.host, `${base}/diff?per_page=100&page=${page}`], url));
            files += diff.length;
            if (diff.length < 100)
                break;
        }
        return { kind: "commit", committed_at: c.committed_date, additions: c.stats.additions, deletions: c.stats.deletions, files };
    }
    throw new Error(`no forge reader for ${url}`);
}
