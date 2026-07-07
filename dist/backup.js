import { gzipSync, gunzipSync } from "node:zlib";
import * as route from "./route.js";
import * as repos from "./repos.js";
// Bump when the archive shape changes in a way an older tack can't read. Import
// refuses an archive whose schemaVersion exceeds this, so a future v2 can ship a
// migration rather than silently mishandling unknown fields.
export const SCHEMA_VERSION = 1;
// Bundle the whole local store into one gzip-compressed JSON document.
export function buildArchive(generator) {
    const routes = route.loadAll();
    const repoDb = repos.loadRepos();
    const pins = route.readAllPins();
    const archive = {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        generator,
        routes,
        repos: repoDb,
        pins,
    };
    const buffer = gzipSync(Buffer.from(JSON.stringify(archive, null, 2), "utf-8"));
    return {
        buffer,
        counts: {
            routes: routes.length,
            repos: Object.keys(repoDb).length,
            pins: Object.keys(pins).length,
        },
    };
}
export function parseArchive(buf) {
    let json;
    try {
        json = gunzipSync(buf).toString("utf-8");
    }
    catch (e) {
        throw new Error(`not a gzip archive (${e.message})`);
    }
    let data;
    try {
        data = JSON.parse(json);
    }
    catch (e) {
        throw new Error(`archive is not valid JSON (${e.message})`);
    }
    const a = data;
    if (typeof a?.schemaVersion !== "number") {
        throw new Error("archive missing schemaVersion");
    }
    if (a.schemaVersion > SCHEMA_VERSION) {
        throw new Error(`archive schemaVersion ${a.schemaVersion} is newer than this tack supports (${SCHEMA_VERSION}); upgrade tack`);
    }
    if (!Array.isArray(a.routes)) {
        throw new Error("archive missing routes[]");
    }
    return a;
}
function maxTackNum(tacks) {
    return tacks.reduce((m, t) => {
        const n = parseInt(t.id.replace(/^t/, ""), 10);
        return Number.isFinite(n) && n > m ? n : m;
    }, 0);
}
// A tack's cross-machine identity: its deliverable URL if it shipped one,
// otherwise summary + completion date. Route-local ids (t1, t2) can't be used —
// the same id means different work on each machine.
function identity(t) {
    return t.deliverable?.url ?? `${t.summary}\u0000${t.done_at ?? ""}`;
}
export function applyImport(archive, opts) {
    const res = {
        mode: opts.mode,
        dryRun: opts.dryRun,
        created: [],
        replaced: [],
        merged: [],
        reposKeysAdded: 0,
        reposNamesAdded: 0,
        pinsRestored: 0,
    };
    if (opts.mode === "replace") {
        for (const r of archive.routes) {
            (route.routeExists(r.slug) ? res.replaced : res.created).push(r.slug);
            if (!opts.dryRun)
                route.writeRoute(r);
        }
        const repoDb = archive.repos ?? {};
        const pins = archive.pins ?? {};
        res.reposKeysAdded = Object.keys(repoDb).length;
        res.pinsRestored = Object.keys(pins).length;
        if (!opts.dryRun) {
            repos.saveReplace(repoDb);
            route.writeAllPins(pins);
        }
        return res;
    }
    // merge: additive. Existing tacks are never mutated; new ones are appended
    // with fresh ids, and depends_on edges are remapped to the resolved ids.
    for (const incoming of archive.routes) {
        if (!route.routeExists(incoming.slug)) {
            res.created.push(incoming.slug);
            if (!opts.dryRun)
                route.writeRoute(incoming);
            continue;
        }
        const local = route.load(incoming.slug);
        const byIdentity = new Map();
        for (const t of local.tacks)
            byIdentity.set(identity(t), t.id);
        let next = maxTackNum(local.tacks);
        const idMap = new Map();
        const newTacks = [];
        const reassignments = [];
        for (const t of incoming.tacks) {
            const key = identity(t);
            const existing = byIdentity.get(key);
            if (existing) {
                idMap.set(t.id, existing);
                continue;
            }
            next += 1;
            const newId = `t${next}`;
            idMap.set(t.id, newId);
            byIdentity.set(key, newId);
            newTacks.push({ ...t, id: newId });
            reassignments.push({ from: t.id, to: newId, summary: t.summary });
        }
        for (const nt of newTacks) {
            if (nt.depends_on) {
                const remapped = nt.depends_on
                    .map((d) => idMap.get(d))
                    .filter((x) => Boolean(x));
                if (remapped.length)
                    nt.depends_on = remapped;
                else
                    delete nt.depends_on;
            }
        }
        if (newTacks.length && !opts.dryRun) {
            route.writeRoute({
                ...local,
                tacks: [...local.tacks, ...newTacks],
                updated_at: new Date().toISOString(),
            });
        }
        res.merged.push({
            slug: incoming.slug,
            added: newTacks.length,
            skipped: incoming.tacks.length - newTacks.length,
            reassignments,
        });
    }
    // repos: union names only. locals are absolute paths from the source machine,
    // so they're dropped — the target re-derives its own (tack repo rebuild).
    const localRepos = repos.loadRepos();
    for (const [key, entry] of Object.entries(archive.repos ?? {})) {
        if (!localRepos[key]) {
            localRepos[key] = { names: [] };
            res.reposKeysAdded += 1;
        }
        for (const name of entry.names ?? []) {
            if (!localRepos[key].names.includes(name)) {
                localRepos[key].names.push(name);
                res.reposNamesAdded += 1;
            }
        }
    }
    if (!opts.dryRun)
        repos.saveReplace(localRepos);
    // pins are machine-specific cwd paths — skipped on merge.
    return res;
}
