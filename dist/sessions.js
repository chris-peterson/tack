// The session store (SESS category): one file per Claude Code session at
// <root>/<year>/sessions/<id>.yaml, holding when the session started, when it
// declared itself finished, and the tacks it drove.
//
// It is its own store because a session has no direct relationship with a
// route: it produces zero or more tacks, and those sit on however many routes
// they belong to. Held inside the route files, a session's own facts were
// copied once per route its tacks landed on, so its start time — and now its
// end — could disagree between them. Nothing about a session is written to a
// route: this store is the only writer, which is what makes disagreement
// impossible rather than merely unlikely.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse, stringify } from "yaml";
import { validate } from "./schema.js";
const TACK_HOME = process.env.TACK_HOME ?? join(homedir(), ".tack");
const YEAR_DIR = /^\d{4}$/;
// The id is the filename stem, so it is checked before it reaches a path.
// Mirrors the schema's pattern ([SESS-02]) for the reason assertValidSlug
// mirrors the route slug's: refused here, the message names what the caller
// typed rather than surfacing as an ajv error after the write looked fine.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function assertValidId(id) {
    if (SESSION_ID.test(id) && id.length <= 200)
        return;
    throw new Error(`Invalid session id: ${id} (letters, digits, dot, underscore, and hyphen only)`);
}
function years() {
    if (!existsSync(TACK_HOME))
        return [];
    return readdirSync(TACK_HOME, { withFileTypes: true })
        .filter((e) => e.isDirectory() && YEAR_DIR.test(e.name))
        .map((e) => e.name)
        .sort();
}
function yearDir(year) {
    return join(TACK_HOME, year, "sessions");
}
// The year a session already sits under, else the one its start puts it in — a
// session that runs past midnight on New Year's Eve stays in the file it
// started in, as a route does.
function sessionPath(id, startedAt) {
    for (const year of years()) {
        const candidate = join(yearDir(year), `${id}.yaml`);
        if (existsSync(candidate))
            return candidate;
    }
    const year = String(startedAt ?? new Date().toISOString()).slice(0, 4);
    return join(yearDir(year), `${id}.yaml`);
}
function now() {
    return new Date().toISOString();
}
function save(session) {
    const path = sessionPath(session.id, session.started_at);
    const dir = join(path, "..");
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const result = validate(session, "session");
    if (!result.valid) {
        throw new Error(`Session validation failed:\n${result.errors.join("\n")}`);
    }
    writeFileSync(path, stringify(session), "utf-8");
}
// The session, or null when the store has never seen it. Null rather than a
// throw because every caller has something to do with an unknown session:
// `end` announces for whoever is listening, and a route's id list can outlive
// the file a hand-edit deleted.
export function load(id) {
    assertValidId(id);
    const path = sessionPath(id);
    if (!existsSync(path))
        return null;
    const data = parse(readFileSync(path, "utf-8"));
    const result = validate(data, "session");
    if (!result.valid) {
        throw new Error(`Invalid session file ${id}.yaml:\n${result.errors.join("\n")}`);
    }
    // The filename is how a session is addressed, and save() writes back to
    // sessionPath(session.id). A file whose internal id disagrees would load here
    // and then be written to the other name on the next touch, which is the check
    // readRoute makes for a route's slug.
    const loaded = data;
    if (loaded.id !== id) {
        throw new Error(`Invalid session file ${id}.yaml:\n` +
            `declares id '${loaded.id}' — rename the file to ${loaded.id}.yaml, ` +
            `or set id: ${id} inside it`);
    }
    return loaded;
}
// Every session in the store, newest first. One unreadable file names itself on
// stderr rather than taking the listing down with it, as [STORE-09] has the
// route scan do.
export function all() {
    const sessions = [];
    for (const year of years()) {
        const dir = yearDir(year);
        if (!existsSync(dir))
            continue;
        for (const f of readdirSync(dir)) {
            if (!f.endsWith(".yaml"))
                continue;
            try {
                const session = load(f.replace(/\.yaml$/, ""));
                if (session)
                    sessions.push(session);
            }
            catch (e) {
                process.stderr.write(`warning: ${e.message}\n`);
            }
        }
    }
    return sessions.sort((a, b) => b.started_at.localeCompare(a.started_at));
}
export function tackRef(slug, tackId) {
    return `${slug}/${tackId}`;
}
// Record that the session is working, optionally on a specific tack. Creating
// the file on first touch is what makes `started_at` the moment the session
// first reached tack at all, rather than per route.
export function record(id, slug, tackId) {
    assertValidId(id);
    const existing = load(id);
    // A session earns a file by producing a tack. Most don't: a conversation that
    // opens a route, reads around and exits is the common case, and a file per
    // glance is a store of records that say nothing happened. A bare touch
    // updates a session that already has a file — where it went is worth knowing
    // about a session whose work is on record — and creates none.
    if (!existing && !tackId)
        return null;
    const session = existing ?? { id, started_at: now() };
    // A session touching tack again is working again, whatever it declared last
    // time: the stamp reads "finished as of now", not "finished once".
    delete session.ended_at;
    // `routes` is the touch list, and a touch that produced no tack is the reason
    // it can't be derived from `tacks` — a session is attributed to the route it
    // opened before any tack exists, which is where most sessions start.
    if (!session.routes)
        session.routes = [];
    if (!session.routes.includes(slug))
        session.routes.push(slug);
    if (tackId) {
        const ref = tackRef(slug, tackId);
        if (!session.tacks)
            session.tacks = [];
        // Re-binding an already-listed tack moves it to the end: the last entry is
        // the session's current focus, so a pivot back to an earlier tack makes it
        // current again rather than leaving a stale tail.
        const idx = session.tacks.indexOf(ref);
        if (idx !== -1)
            session.tacks.splice(idx, 1);
        session.tacks.push(ref);
    }
    save(session);
    return session;
}
// Stamp the session finished. The stamp is what separates a session that said
// it was done from one that stopped talking: a reader ageing out
// work-in-progress can only guess at the second, and every guess is a
// threshold it has to invent.
export function end(id) {
    assertValidId(id);
    const session = load(id);
    if (!session)
        return null;
    session.ended_at = now();
    save(session);
    return session;
}
export function remove(id) {
    assertValidId(id);
    const path = sessionPath(id);
    if (existsSync(path))
        unlinkSync(path);
}
// The tacks a session drove on one route, as bare route-scoped ids. The
// `session.ended` payload ([EVENTS-05]) is route-scoped, so the cross-route
// refs are filtered and narrowed here rather than at the caller.
export function tacksOn(id, slug) {
    const prefix = `${slug}/`;
    return (load(id)?.tacks ?? [])
        .filter((ref) => ref.startsWith(prefix))
        .map((ref) => ref.slice(prefix.length));
}
// The sessions that touched a route, newest first, and what each drove there.
// With nothing about sessions written to a route file, this scan is how a route
// answers "who worked this" — see `onRoutes` for the caller that needs it for
// several routes at once and should not scan per route.
export function onRoute(slug) {
    return all().filter((s) => s.routes?.includes(slug));
}
// Rewrite the references to a route across every session, for the commands that
// move work rather than end it: rename, move, merge, and the route merge. A
// tack ref mapping to null is dropped — the merge does that for a tack that no
// longer exists. `slugs` renames a whole route, carrying the touch list with it.
//
// Returns the ids of the sessions it rewrote, so a caller can report the reach
// of what it just did.
export function remapRefs(map, slugs = new Map()) {
    if (map.size === 0 && slugs.size === 0)
        return [];
    const touched = [];
    for (const session of all()) {
        const before = JSON.stringify([session.routes, session.tacks]);
        if (session.tacks?.length) {
            const next = [];
            for (const ref of session.tacks) {
                const mapped = map.has(ref) ? map.get(ref) : ref;
                if (mapped === null)
                    continue;
                // A remap can collide two refs onto one; the later touch wins, which is
                // the same rule `record` applies to a re-bound tack.
                const idx = next.indexOf(mapped);
                if (idx !== -1)
                    next.splice(idx, 1);
                next.push(mapped);
            }
            if (next.length)
                session.tacks = next;
            else
                delete session.tacks;
        }
        if (session.routes?.length) {
            const next = [];
            for (const slug of session.routes) {
                const mapped = slugs.has(slug) ? slugs.get(slug) : slug;
                if (mapped === null)
                    continue;
                if (!next.includes(mapped))
                    next.push(mapped);
            }
            // A tack that moved in brings its route with it, so the touch list stays
            // the superset of the slugs in `tacks` that [SESS-04] promises.
            for (const ref of session.tacks ?? []) {
                const slug = ref.slice(0, ref.lastIndexOf("/"));
                if (!next.includes(slug))
                    next.push(slug);
            }
            if (next.length)
                session.routes = next;
            else
                delete session.routes;
        }
        if (JSON.stringify([session.routes, session.tacks]) === before)
            continue;
        save(session);
        touched.push(session.id);
    }
    return touched;
}
