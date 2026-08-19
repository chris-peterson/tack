import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import { maxLength, validate } from "./schema.js";
import * as repos from "./repos.js";
const TACK_HOME = process.env.TACK_HOME ?? join(homedir(), ".tack");
const TACK_DIR = join(TACK_HOME, "routes");
export function isOpen(t) {
    return t.status !== "done" && t.status !== "dropped";
}
// Whether a route is finished is a function of its tacks, never a field of its
// own: it is done when it holds tacks and none of them are open, and adding a
// fresh tack reopens it. Stored, the two would drift the moment a tack landed
// without the route being touched.
//
// An empty route is active — "done" would claim completed work that never
// existed. The word is `state` rather than `status` because a tack's `status`
// is set by the caller and this one cannot be.
export function routeState(route) {
    if (route.tacks.length === 0)
        return "active";
    return route.tacks.some(isOpen) ? "active" : "done";
}
// Mirrors the schema's slug pattern. Callers that accept a slug from the user
// check it here so the failure names the rule, instead of surfacing as an ajv
// pattern error from save() after the command already looked like it worked.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
export function assertValidSlug(slug, what = "slug") {
    if (SLUG_PATTERN.test(slug))
        return;
    throw new Error(`Invalid ${what}: ${slug} (lowercase letters, digits, and inner hyphens only)`);
}
// Mirrors the schema's length limits at the command boundary, for the reason
// assertValidSlug mirrors its slug pattern: refused here, the message names the
// thing the caller typed. Left to save(), the same input surfaces as the ajv
// path `/tacks/0/after/0/text`, which is an array index into a file the caller
// never opened.
//
// The limit is read from the schema ([STORE-04]) rather than restated, and the
// value is measured after the cleaning save() will apply — otherwise text that
// only exceeds the limit in whitespace the write is about to collapse would be
// refused for a length it never gets stored at.
function assertLength(value, key, what) {
    const limit = maxLength(key);
    if (value.length <= limit)
        return;
    throw new Error(`${what} is ${value.length} characters; the limit is ${limit}`);
}
function assertLineLength(value, key, what) {
    assertLength(cleanLine(value), key, what);
}
function assertBlockLength(value, key, what) {
    assertLength(cleanBlock(value), key, what);
}
// Free text in a route is not always something the user typed. `tack describe
// --file -` is documented as taking an issue body straight off a forge, and the
// start skill drives exactly that, so a description — and a summary derived from
// one — is attacker-authored prose. It then goes two places that read control
// characters as commands rather than as text: a terminal, where an ESC sequence
// repaints the screen, and an agent's context, where a newline in a field
// rendered inline forges the structure around it.
//
// Stripping happens on the way in and out of the file rather than at each of the
// dozen render sites, so display, `--json`, and the web view all get text that is
// safe to print, and a route file that already holds a payload is cleaned when
// it loads.
//
// Tab and newline are legitimate in prose; every other C0 control, DEL, and
// the C1 range are not, and are what a terminal reads as an escape sequence.
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const CONTROL_CHARS_AND_BREAKS = /[\u0000-\u001F\u007F-\u009F]+/g;
// Prose that keeps its line structure: newlines and tabs survive, everything
// else in the C0/C1 ranges does not.
function cleanBlock(s) {
    return s.replace(CONTROL_CHARS, "");
}
// Text rendered inline, where a line break would forge structure in the output:
// every control character becomes a space, and the runs that leaves collapse —
// the indentation that followed a stripped newline is not meaningful once the
// line break is gone.
function cleanLine(s) {
    return s.replace(CONTROL_CHARS_AND_BREAKS, " ").replace(/\s+/g, " ").trim();
}
function cleanTodo(items) {
    for (const i of items ?? [])
        i.text = cleanLine(i.text);
}
// Mutates in place: the caller either just parsed this object or is about to
// serialize it, and a copy would leave the original as the one that gets written.
export function sanitizeRoute(route) {
    if (route.title !== undefined)
        route.title = cleanLine(route.title);
    if (route.description !== undefined)
        route.description = cleanBlock(route.description);
    for (const t of route.tacks) {
        t.summary = cleanLine(t.summary);
        if (t.deliverable)
            t.deliverable.label = cleanLine(t.deliverable.label);
        for (const l of t.links ?? [])
            l.label = cleanLine(l.label);
        cleanTodo(t.before);
        cleanTodo(t.after);
    }
    return route;
}
function routeSlugs() {
    ensureDir();
    return readdirSync(TACK_DIR)
        .filter((f) => f.endsWith(".yaml"))
        .map((f) => f.replace(/\.yaml$/, ""));
}
// Route files this process passed over. Keyed by slug so one run reports each
// file once, however many scans it made — a listing and the URL-collision check
// behind it both walk the store.
const skipped = new Map();
export function invalidRoutes() {
    return [...skipped.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}
// The server re-scans on every request and the test suite drives many stores
// through one process; both need the record to start empty rather than carry
// the previous scan's findings.
export function clearInvalidRoutes() {
    skipped.clear();
}
function recordSkip(slug, errors) {
    skipped.set(slug, { slug, file: routePath(slug), errors });
}
// Load every route file, recording the ones that cannot be read instead of
// stopping at the first ([STORE-09]). The caller renders what it got and the
// CLI reports `invalidRoutes()` before exiting non-zero, so the gap is loud:
// a skipped route that nothing mentions is the invisible route this used to
// fail hard to avoid.
export function scanAll() {
    const routes = [];
    for (const slug of routeSlugs()) {
        const read = readRoute(slug);
        if ("route" in read)
            routes.push(read.route);
        else
            recordSkip(slug, read.errors);
    }
    return routes;
}
// Every route file, or a throw naming the first that cannot be read. For the
// callers whose answer is wrong when it is incomplete — the export archive,
// where a quietly omitted route is a lossy backup wearing a zero exit.
export function loadAll() {
    return routeSlugs().map((slug) => load(slug));
}
function ensureDir() {
    if (!existsSync(TACK_DIR)) {
        mkdirSync(TACK_DIR, { recursive: true });
    }
}
function routePath(slug) {
    return join(TACK_DIR, `${slug}.yaml`);
}
function now() {
    return new Date().toISOString();
}
// Repo-database capture (REPO-06, REPO-07) is best-effort: it enriches the repo
// index as a side effect of recording URLs and pinning, and must never fail
// the command that triggered it.
function captureBestEffort(fn) {
    try {
        fn();
    }
    catch (e) {
        process.stderr.write(`warning: repo capture failed: ${e.message}\n`);
    }
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export function normalizeTimestamp(input) {
    if (ISO_DATE.test(input) || ISO_DATE_TIME.test(input)) {
        const parsed = new Date(input);
        if (!Number.isNaN(parsed.getTime()))
            return input;
    }
    throw new Error(`Invalid timestamp: ${input} (expected YYYY-MM-DD or ISO 8601 date-time)`);
}
function readRoute(slug) {
    const path = routePath(slug);
    if (!existsSync(path)) {
        throw new Error(`Route not found: ${slug}`);
    }
    let data;
    try {
        data = parse(readFileSync(path, "utf-8"));
    }
    catch (e) {
        // The parser's own message carries the line and column; the frames after
        // its first line are the YAML library's, not the user's file.
        return { errors: [`not parseable as YAML: ${e.message.split("\n")[0]}`] };
    }
    const result = validate(data);
    if (!result.valid)
        return { errors: result.errors };
    // The filename is how a route is addressed; save() writes back to
    // routePath(route.slug). A file whose internal slug disagrees would load here
    // and then be written to the other name on the next mutation, renaming the
    // route with nothing said.
    const loaded = data;
    if (loaded.slug !== slug) {
        return {
            errors: [
                `declares slug '${loaded.slug}' — rename the file to ${loaded.slug}.yaml, ` +
                    `or set slug: ${slug} inside it`,
            ],
        };
    }
    return { route: sanitizeRoute(loaded) };
}
export function load(slug) {
    const read = readRoute(slug);
    if ("route" in read)
        return read.route;
    throw new Error(`Invalid route file ${slug}.yaml:\n${read.errors.join("\n")}`);
}
// A tack date may be a bare `YYYY-MM-DD` (accepted for backward compatibility),
// but `created_at` is date-time in the schema, so widen before adopting one.
function asDateTime(date) {
    return date.includes("T") ? date : `${date}T00:00:00.000Z`;
}
// A route's creation cannot postdate its own work. Routes built by a
// consolidation pass stamp created_at = now() while the tacks backfilled into
// them carry historical dates, which left routes whose earliest tack predates
// their own creation by months.
//
// The floor only ratchets earlier. A full min/max recompute would shove
// creation forward when the earliest tack is deleted, and a route's birth is
// monotonic — it does not un-happen. `updated_at` stays touch-on-write for the
// same reason in reverse: it has to bump on mutations that touch no tack date
// at all (rename, regroup, a link added), which a max-of-children can't see.
function floorCreatedAt(route) {
    const earliest = route.tacks
        .map((t) => t.done_at)
        .filter((d) => Boolean(d))
        .sort()[0];
    if (earliest && asDateTime(earliest) < route.created_at) {
        route.created_at = asDateTime(earliest);
    }
}
function save(route) {
    ensureDir();
    route.updated_at = now();
    floorCreatedAt(route);
    // Every mutation lands here, which is where the text a command just supplied
    // gets cleaned — `tack describe --file -` reads a forge issue body off stdin.
    sanitizeRoute(route);
    const result = validate(route);
    if (!result.valid) {
        throw new Error(`Route validation failed:\n${result.errors.join("\n")}`);
    }
    writeFileSync(routePath(route.slug), stringify(route), "utf-8");
}
// Import/restore: write a route object verbatim (validated) without bumping
// updated_at, so a full restore preserves timestamps and a merge sets its own.
export function writeRoute(route) {
    ensureDir();
    // An imported archive is as untrusted as a forge issue body — it arrives from
    // another machine — and this path bypasses load(), so it cleans its own input.
    sanitizeRoute(route);
    const result = validate(route);
    if (!result.valid) {
        throw new Error(`Route validation failed:\n${result.errors.join("\n")}`);
    }
    writeFileSync(routePath(route.slug), stringify(route), "utf-8");
}
export function routeExists(slug) {
    return existsSync(routePath(slug));
}
export function init(slug, opts = {}) {
    assertValidSlug(slug);
    if (opts.group)
        assertValidSlug(opts.group, "group");
    ensureDir();
    const path = routePath(slug);
    if (existsSync(path)) {
        throw new Error(`Route already exists: ${slug}`);
    }
    const route = {
        id: randomUUID(),
        slug,
        created_at: now(),
        updated_at: now(),
        tacks: [],
    };
    if (opts.group)
        route.group = opts.group;
    save(route);
    captureBestEffort(() => repos.recordCwd(process.cwd()));
    return route;
}
export function list() {
    return scanAll().map((r) => ({
        slug: r.slug, title: r.title, group: r.group, total: r.tacks.length, open: r.tacks.filter(isOpen).length,
        state: routeState(r),
    }));
}
function nextTackNumber(route) {
    if (route.tacks.length === 0)
        return 1;
    const max = Math.max(...route.tacks.map((t) => parseInt(t.id.slice(1), 10)));
    if (Number.isNaN(max)) {
        throw new Error(`Route ${route.slug} has a tack with a non-numeric id; cannot compute next id`);
    }
    return max + 1;
}
function nextTackId(route) {
    return `t${nextTackNumber(route)}`;
}
function nextTodoId(items, prefix) {
    if (items.length === 0)
        return `${prefix}1`;
    const max = Math.max(...items.map((item) => parseInt(item.id.slice(1), 10)));
    return `${prefix}${max + 1}`;
}
// Tack ids display as `t<N>`, but a bare `<N>` is the natural thing to type.
// Normalize both forms to the canonical `t<N>` at the lookup boundary so every
// subcommand that takes a tack id accepts `7` and `t7` interchangeably. Inputs
// that aren't a tack id are returned unchanged, so a bad value still surfaces
// the same "not found" error.
export function normalizeTackId(id) {
    const m = id.match(/^t?(\d+)$/);
    return m ? `t${m[1]}` : id;
}
function findTack(route, tackId) {
    const id = normalizeTackId(tackId);
    const tack = route.tacks.find((t) => t.id === id);
    if (!tack) {
        throw new Error(`Tack not found: ${id} in route ${route.slug}`);
    }
    return tack;
}
function findTodo(tack, todoId) {
    const beforeItem = tack.before?.find((t) => t.id === todoId);
    if (beforeItem)
        return { item: beforeItem, list: "before" };
    const afterItem = tack.after?.find((t) => t.id === todoId);
    if (afterItem)
        return { item: afterItem, list: "after" };
    throw new Error(`Todo not found: ${todoId} in tack ${tack.id}`);
}
function checkDependencies(route, dependsOn) {
    for (const depId of dependsOn) {
        const dep = route.tacks.find((t) => t.id === depId);
        if (!dep) {
            throw new Error(`Dependency not found: ${depId}`);
        }
    }
}
function detectCycle(route, tackId, dependsOn) {
    const visited = new Set();
    function walk(id) {
        if (id === tackId) {
            throw new Error(`Circular dependency detected involving ${tackId}`);
        }
        if (visited.has(id))
            return;
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
export function addTack(slug, summary, opts = {}) {
    assertLineLength(summary, "tack.summary", "tack summary");
    const route = load(slug);
    const id = nextTackId(route);
    const dependsOn = opts.dependsOn?.map(normalizeTackId);
    if (dependsOn?.length) {
        checkDependencies(route, dependsOn);
        detectCycle(route, id, dependsOn);
    }
    const tack = {
        id,
        summary,
        status: opts.done ? "done" : "pending",
    };
    if (dependsOn?.length)
        tack.depends_on = dependsOn;
    if (opts.deliverable)
        tack.deliverable = opts.deliverable;
    if (opts.done)
        tack.done_at = opts.doneAt ? normalizeTimestamp(opts.doneAt) : now();
    // Attach any links, deduping against the deliverable and each other so
    // `--link` on creation obeys the same no-op-on-duplicate rule as `link add`.
    if (opts.links?.length) {
        const links = [];
        for (const link of opts.links) {
            if (tack.deliverable?.url === link.url)
                continue;
            if (links.some((l) => l.url === link.url))
                continue;
            links.push(link);
        }
        if (links.length)
            tack.links = links;
    }
    route.tacks.push(tack);
    save(route);
    if (opts.deliverable)
        captureBestEffort(() => repos.recordUrl(opts.deliverable.url));
    if (tack.links) {
        for (const link of tack.links)
            captureBestEffort(() => repos.recordUrl(link.url));
    }
    return tack;
}
export function markDone(slug, tackId, opts = {}) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    tack.status = "done";
    if (opts.at) {
        tack.done_at = normalizeTimestamp(opts.at);
    }
    else if (!tack.done_at) {
        tack.done_at = now();
    }
    let ambiguousDeliverable = [];
    let promotedUrl;
    if (!tack.deliverable && tack.links?.length) {
        const prLinks = tack.links.filter((l) => isPrOrMrUrl(l.url));
        if (prLinks.length === 1) {
            const prLink = prLinks[0];
            tack.deliverable = { label: prLink.label, url: prLink.url };
            promotedUrl = prLink.url;
            tack.links = tack.links.filter((l) => l !== prLink);
            if (tack.links.length === 0)
                delete tack.links;
        }
        else if (prLinks.length > 1) {
            ambiguousDeliverable = prLinks.map((l) => ({ label: l.label, url: l.url }));
        }
    }
    const pendingTodo = (tack.after ?? [])
        .filter((a) => !a.done)
        .map((a) => a.text);
    save(route);
    if (promotedUrl)
        captureBestEffort(() => repos.recordUrl(promotedUrl));
    return { tack, pendingTodo, ambiguousDeliverable };
}
export function markDropped(slug, tackId) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    tack.status = "dropped";
    save(route);
    return tack;
}
export function startTack(slug, tackId) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    if (tack.depends_on?.length) {
        const unmet = tack.depends_on.filter((depId) => {
            const dep = route.tacks.find((t) => t.id === depId);
            return dep && dep.status !== "done";
        });
        if (unmet.length) {
            throw new Error(`Cannot start ${tackId}: unmet dependencies: ${unmet.join(", ")}. ` +
                `Drop the edge with \`tack depends rm ${slug} ${tackId} <dep-id>\` ` +
                `if these are actually parallel, or use \`tack status set ${slug} ${tackId} in_progress\` ` +
                `to write the status anyway.`);
        }
    }
    tack.status = "in_progress";
    save(route);
    return tack;
}
export function setStatus(slug, tackId, status) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    tack.status = status;
    if (status === "done" && !tack.done_at) {
        tack.done_at = now();
    }
    save(route);
    return tack;
}
export function addDependency(slug, tackId, depId) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    depId = normalizeTackId(depId);
    if (tack.id === depId) {
        throw new Error(`Cannot depend on self: ${tack.id}`);
    }
    findTack(route, depId);
    if (tack.depends_on?.includes(depId)) {
        return tack;
    }
    const proposed = [...(tack.depends_on ?? []), depId];
    detectCycle(route, tackId, proposed);
    tack.depends_on = proposed;
    save(route);
    return tack;
}
export function removeDependency(slug, tackId, depId) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    depId = normalizeTackId(depId);
    if (!tack.depends_on?.includes(depId)) {
        throw new Error(`${tack.id} does not depend on ${depId} in route ${slug}`);
    }
    tack.depends_on = tack.depends_on.filter((id) => id !== depId);
    if (tack.depends_on.length === 0)
        delete tack.depends_on;
    save(route);
    return tack;
}
export function rename(oldSlug, newSlug) {
    assertValidSlug(newSlug);
    if (oldSlug === newSlug) {
        throw new Error(`Old and new slug are the same: ${oldSlug}`);
    }
    const oldPath = routePath(oldSlug);
    const newPath = routePath(newSlug);
    if (!existsSync(oldPath)) {
        throw new Error(`Route not found: ${oldSlug}`);
    }
    if (existsSync(newPath)) {
        throw new Error(`Route already exists: ${newSlug}`);
    }
    // Strict, unlike the listings: this sweep is what stops a rename from
    // dangling another route's `depends_on`, and a file it could not read is a
    // file whose references it cannot rule out. `tack doctor` names what to fix.
    const all = loadAll();
    const referers = all
        .filter((r) => r.slug !== oldSlug && r.depends_on?.includes(oldSlug))
        .map((r) => r.slug);
    if (referers.length > 0) {
        throw new Error(`Cannot rename ${oldSlug}: referenced by ${referers.join(", ")}. ` +
            `Remove the reference from depends_on first.`);
    }
    const route = all.find((r) => r.slug === oldSlug);
    route.slug = newSlug;
    route.updated_at = now();
    const result = validate(route);
    if (!result.valid) {
        throw new Error(`Route validation failed:\n${result.errors.join("\n")}`);
    }
    writeFileSync(oldPath, stringify(route), "utf-8");
    renameSync(oldPath, newPath);
    return route;
}
export function setGroup(slug, group) {
    // load() first: a missing route is a fact about the argument the caller named,
    // and reporting it takes precedence over the group's shape.
    const route = load(slug);
    assertValidSlug(group, "group");
    route.group = group;
    save(route);
    return route;
}
export function clearGroup(slug) {
    const route = load(slug);
    delete route.group;
    save(route);
    return route;
}
export function setTitle(slug, title) {
    assertLineLength(title, "route.title", "route title");
    const route = load(slug);
    route.title = title;
    save(route);
    return route;
}
export function clearTitle(slug) {
    const route = load(slug);
    delete route.title;
    save(route);
    return route;
}
export function setDescription(slug, description) {
    assertBlockLength(description, "route.description", "route description");
    const route = load(slug);
    route.description = description;
    save(route);
    return route;
}
export function clearDescription(slug) {
    const route = load(slug);
    delete route.description;
    save(route);
    return route;
}
export function setDeliverable(slug, tackId, label, url, opts = {}) {
    assertLineLength(label, "deliverable.label", "deliverable label");
    assertLength(url, "deliverable.url", "deliverable url");
    const route = load(slug);
    const tack = findTack(route, tackId);
    if (tack.deliverable && !opts.force) {
        const existing = `${tack.deliverable.label} — ${tack.deliverable.url}`;
        throw new Error(`${tackId} already has a deliverable: ${existing}. Pass --force to overwrite.`);
    }
    tack.deliverable = { label, url };
    if (tack.links?.length) {
        tack.links = tack.links.filter((l) => l.url !== url);
        if (tack.links.length === 0)
            delete tack.links;
    }
    save(route);
    captureBestEffort(() => repos.recordUrl(url));
    return tack;
}
export function removeDeliverable(slug, tackId, opts = {}) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    if (!tack.deliverable) {
        throw new Error(`${slug}/${tackId} has no deliverable to remove.`);
    }
    const { label, url } = tack.deliverable;
    delete tack.deliverable;
    // --to-link relocates the URL into links. Clearing the deliverable first
    // sidesteps addLink's dedupe no-op (which skips a URL still held as the
    // deliverable); the demoted link is only skipped when the URL is already
    // present in links, matching tack's existing dedupe behavior.
    if (opts.toLink && !tack.links?.some((l) => l.url === url)) {
        if (!tack.links)
            tack.links = [];
        tack.links.push({ label, url });
    }
    save(route);
    return tack;
}
export function addBefore(slug, tackId, text) {
    assertLineLength(text, "todoItem.text", "note text");
    const route = load(slug);
    const tack = findTack(route, tackId);
    if (!tack.before)
        tack.before = [];
    const id = nextTodoId(tack.before, "b");
    tack.before.push({ id, text, done: false });
    save(route);
    return tack;
}
export function addAfter(slug, tackId, text) {
    assertLineLength(text, "todoItem.text", "note text");
    const route = load(slug);
    const tack = findTack(route, tackId);
    if (!tack.after)
        tack.after = [];
    const id = nextTodoId(tack.after, "a");
    tack.after.push({ id, text, done: false });
    save(route);
    return tack;
}
export function completeTodo(slug, tackId, todoId) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    const { item } = findTodo(tack, todoId);
    item.done = true;
    if (!item.done_at)
        item.done_at = now();
    save(route);
    return tack;
}
export function dropTodo(slug, tackId, todoId) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    const { list } = findTodo(tack, todoId);
    if (list === "before") {
        tack.before = tack.before.filter((t) => t.id !== todoId);
    }
    else {
        tack.after = tack.after.filter((t) => t.id !== todoId);
    }
    save(route);
    return tack;
}
function parseChangeRefUrl(url) {
    const gh = url.match(/^https:\/\/github\.com\/[^/]+\/([^/]+)\/(pull|issues)\/(\d+)/);
    if (gh) {
        return { repo: gh[1], ref: gh[3], kind: gh[2] === "pull" ? "pr" : "issue" };
    }
    const ghCommit = url.match(/^https:\/\/github\.com\/[^/]+\/([^/]+)\/commit\/([0-9a-f]+)/i);
    if (ghCommit) {
        return { repo: ghCommit[1], ref: ghCommit[2].slice(0, 7), kind: "commit" };
    }
    // `work_items` is GitLab's newer path for the same issue `/-/issues/<n>`
    // serves, so it derives the same ref. Epics live under /groups/<group>/-/,
    // which puts the group where a project name sits in the other forms — the
    // captured name is the group, which is what an epic belongs to.
    const gl = url.match(/^https:\/\/gitlab\.[^/]*\/.*?\/([^/]+)\/-\/(merge_requests|issues|work_items|epics|milestones)\/(\d+)/);
    if (gl) {
        const kinds = {
            merge_requests: "mr",
            issues: "issue",
            work_items: "issue",
            epics: "epic",
            milestones: "milestone",
        };
        return { repo: gl[1], ref: gl[3], kind: kinds[gl[2]] };
    }
    const glCommit = url.match(/^https:\/\/gitlab\.[^/]*\/.*?\/([^/]+)\/-\/commit\/([0-9a-f]+)/i);
    if (glCommit) {
        return { repo: glCommit[1], ref: glCommit[2].slice(0, 7), kind: "commit" };
    }
    return null;
}
export function isPrOrMrUrl(url) {
    const ref = parseChangeRefUrl(url);
    return ref !== null && (ref.kind === "pr" || ref.kind === "mr");
}
// Canonical forge notation attaches a kind-specific sigil to the repo:
// `repo#42` for a PR/issue, `repo!99` for an MR, `repo@<sha7>` for a commit.
// Epics and milestones reuse GitLab's own reference syntax, `&` and `%`.
const CHANGE_REF_SIGIL = {
    pr: "#",
    issue: "#",
    mr: "!",
    commit: "@",
    epic: "&",
    milestone: "%",
};
export function deriveDeliverableLabel(url) {
    const ref = parseChangeRefUrl(url);
    if (!ref)
        return url;
    return `${ref.repo}${CHANGE_REF_SIGIL[ref.kind]}${ref.ref}`;
}
export function addLink(slug, tackId, label, url) {
    assertLineLength(label, "link.label", "link label");
    assertLength(url, "link.url", "link url");
    const route = load(slug);
    const tack = findTack(route, tackId);
    if (tack.deliverable?.url === url)
        return tack;
    if (tack.links?.some((l) => l.url === url))
        return tack;
    if (!tack.links)
        tack.links = [];
    tack.links.push({ label, url });
    save(route);
    captureBestEffort(() => repos.recordUrl(url));
    return tack;
}
export function removeLink(slug, tackId, url) {
    const route = load(slug);
    const tack = findTack(route, tackId);
    const idx = tack.links?.findIndex((l) => l.url === url) ?? -1;
    if (idx < 0) {
        throw new Error(`No link with url "${url}" on ${slug}/${tackId}`);
    }
    tack.links.splice(idx, 1);
    if (tack.links.length === 0)
        delete tack.links;
    save(route);
    return tack;
}
export function editTack(slug, tackId, summary) {
    assertLineLength(summary, "tack.summary", "tack summary");
    const route = load(slug);
    const tack = findTack(route, tackId);
    tack.summary = summary;
    save(route);
    return tack;
}
export function mergeTacks(slug, sourceId, targetId) {
    const route = load(slug);
    const source = findTack(route, sourceId);
    const target = findTack(route, targetId);
    if (source.id === target.id) {
        throw new Error("Cannot merge a tack into itself");
    }
    if (!target.deliverable && source.deliverable) {
        target.deliverable = source.deliverable;
    }
    if (source.before?.length) {
        if (!target.before)
            target.before = [];
        for (const item of source.before) {
            const id = nextTodoId(target.before, "b");
            target.before.push({ ...item, id });
        }
    }
    if (source.after?.length) {
        if (!target.after)
            target.after = [];
        for (const item of source.after) {
            const id = nextTodoId(target.after, "a");
            target.after.push({ ...item, id });
        }
    }
    if (source.links?.length) {
        if (!target.links)
            target.links = [];
        for (const link of source.links) {
            target.links.push({ ...link });
        }
    }
    route.tacks = route.tacks.filter((t) => t.id !== source.id);
    save(route);
    return target;
}
export function recordSession(slug, sessionId, tackId) {
    const route = load(slug);
    if (!route.sessions)
        route.sessions = [];
    let session = route.sessions.find((s) => s.id === sessionId);
    if (!session) {
        session = { id: sessionId, started_at: now() };
        route.sessions.push(session);
    }
    if (tackId !== undefined) {
        // findTack validates existence and normalizes a bare `<N>` to `t<N>`.
        const id = findTack(route, tackId).id;
        if (!session.tacks)
            session.tacks = [];
        // Re-binding an already-listed tack moves it to the end: the last entry
        // is the session's current focus, so a pivot back to an earlier tack
        // makes it current again rather than leaving a stale tail.
        const idx = session.tacks.indexOf(id);
        if (idx !== -1)
            session.tacks.splice(idx, 1);
        session.tacks.push(id);
    }
    save(route);
    return route;
}
export function recent(opts = {}) {
    let routes = scanAll().map((r) => ({
        slug: r.slug, group: r.group, updated_at: r.updated_at, total: r.tacks.length, open: r.tacks.filter(isOpen).length,
    }));
    routes.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (opts.since) {
        const parsed = new Date(opts.since);
        if (Number.isNaN(parsed.getTime())) {
            throw new Error(`Invalid --since value: ${opts.since}`);
        }
        const sinceDate = parsed.toISOString();
        routes = routes.filter((r) => r.updated_at >= sinceDate);
    }
    const count = opts.count ?? 10;
    return routes.slice(0, count);
}
// Scan every route/tack, collecting a FindMatch for each deliverable or link
// URL the predicate accepts. Shared by find() (exact URL) and findByRepoKey()
// (same repo), so both render identically through formatFind.
function findBy(accepts) {
    const matches = [];
    for (const r of scanAll()) {
        const routeOpen = r.tacks.filter(isOpen).length;
        for (const tack of r.tacks) {
            const base = { slug: r.slug, group: r.group, routeTotal: r.tacks.length, routeOpen, tackId: tack.id, summary: tack.summary, status: tack.status, done_at: tack.done_at };
            if (tack.deliverable && accepts(tack.deliverable.url)) {
                matches.push({ ...base, match: "deliverable", label: tack.deliverable.label, url: tack.deliverable.url });
            }
            if (tack.links) {
                for (const link of tack.links) {
                    if (accepts(link.url)) {
                        matches.push({ ...base, match: "link", label: link.label, url: link.url });
                    }
                }
            }
        }
    }
    return matches;
}
// GitLab serves one issue from two paths, so two recordings of the same issue
// are not string-equal. Canonicalize the newer form onto the older one for
// comparison only — stored URLs stay exactly as the caller gave them, since
// that is the link the user actually followed.
export function canonicalizeUrl(url) {
    return url.replace(/^(https:\/\/gitlab\.[^/]*\/.*?\/-\/)work_items(\/\d+)/, "$1issues$2");
}
export function find(url) {
    const target = canonicalizeUrl(url);
    return findBy((u) => canonicalizeUrl(u) === target);
}
// CLI-23a: return every tack whose deliverable or link URL belongs to the given
// repo key, computed via the forge-URL recognition rules ([CLI-37]). Powers
// `tack find --path`, which resolves a working directory to a repo key first.
export function findByRepoKey(key) {
    return findBy((u) => repos.repoKeyFromForgeUrl(u) === key);
}
// Return every tack that already references this URL, excluding the tack being
// mutated (so an idempotent re-attach to the same tack does not count as a
// collision). Reuses find()'s exact-URL matching — same rule as `tack find`.
export function findCollisions(url, exclude) {
    return find(url).filter((m) => !(m.slug === exclude.slug && m.tackId === exclude.tackId));
}
// CLI-47: backfill the repo database from existing tack data — every forge URL
// recorded on a route.
export function rebuildRepos() {
    const urls = [];
    for (const r of scanAll()) {
        for (const tack of r.tacks) {
            if (tack.deliverable?.url)
                urls.push(tack.deliverable.url);
            for (const link of tack.links ?? [])
                urls.push(link.url);
        }
    }
    return repos.rebuildFrom({ urls });
}
// CLI-57: read every route file and report what will not load, changing
// nothing. Repair is a hand edit, so the report's job is to name the file and
// the rule it breaks — otherwise finding that out means reading the schema.
export function doctor() {
    clearInvalidRoutes();
    const readable = scanAll().length;
    const invalid = invalidRoutes();
    clearInvalidRoutes();
    return { files: readable + invalid.length, invalid };
}
export function remove(slug) {
    const path = routePath(slug);
    if (!existsSync(path)) {
        throw new Error(`Route not found: ${slug}`);
    }
    unlinkSync(path);
}
export function moveTack(srcSlug, srcTackId, dstSlug, opts = {}) {
    if (srcSlug === dstSlug) {
        throw new Error(`Source and destination routes are the same: ${srcSlug}`);
    }
    const srcRoute = load(srcSlug);
    const dstRoute = load(dstSlug);
    findTack(srcRoute, srcTackId);
    const movingIds = new Set([srcTackId]);
    if (opts.includeDependents) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const t of srcRoute.tacks) {
                if (movingIds.has(t.id))
                    continue;
                if (t.depends_on?.some((dep) => movingIds.has(dep))) {
                    movingIds.add(t.id);
                    changed = true;
                }
            }
        }
    }
    const moving = srcRoute.tacks.filter((t) => movingIds.has(t.id));
    const staying = srcRoute.tacks.filter((t) => !movingIds.has(t.id));
    const outgoing = [];
    for (const t of moving) {
        for (const dep of t.depends_on ?? []) {
            if (!movingIds.has(dep))
                outgoing.push({ from: t.id, to: dep });
        }
    }
    const incoming = [];
    for (const t of staying) {
        for (const dep of t.depends_on ?? []) {
            if (movingIds.has(dep))
                incoming.push({ from: t.id, to: dep });
        }
    }
    if (outgoing.length > 0 || incoming.length > 0) {
        const lines = [];
        if (outgoing.length > 0) {
            lines.push("  outgoing (moving → staying):");
            for (const e of outgoing)
                lines.push(`    ${e.from} → ${e.to}`);
        }
        if (incoming.length > 0) {
            lines.push("  incoming (staying → moving):");
            for (const e of incoming)
                lines.push(`    ${e.from} → ${e.to}`);
        }
        const includeHint = !opts.includeDependents && incoming.length > 0 && outgoing.length === 0
            ? `  - tack move ${srcSlug}/${srcTackId} ${dstSlug} --include-dependents   move the dependent chain together\n`
            : "";
        throw new Error(`Cannot move ${srcSlug}/${srcTackId} to ${dstSlug}: depends_on edges cross the route boundary. ` +
            `Tack IDs are route-local; cross-route references are not supported.\n` +
            lines.join("\n") +
            `\nResolve by:\n` +
            includeHint +
            `  - tack depends rm <slug> <tack-id> <dep-id>                       break each edge\n`);
    }
    let nextN = nextTackNumber(dstRoute);
    const idMap = new Map();
    for (const t of moving)
        idMap.set(t.id, `t${nextN++}`);
    const movedReport = [];
    for (const src of moving) {
        const dst = { ...structuredClone(src), id: idMap.get(src.id) };
        if (src.depends_on?.length) {
            dst.depends_on = src.depends_on.map((dep) => idMap.get(dep));
        }
        dstRoute.tacks.push(dst);
        movedReport.push({ srcId: src.id, dstId: dst.id, summary: src.summary });
    }
    srcRoute.tacks = staying;
    save(dstRoute);
    save(srcRoute);
    return { srcRoute, dstRoute, moved: movedReport };
}
// Fold every source route into one new route. Morally `init` + N×`moveTack` +
// N×`remove`, but done as one pass so destination t-IDs land in chronological
// order rather than command order, and the umbrella route's created_at reflects
// the work's real age rather than today (issue #8).
export function mergeRoutes(newSlug, srcSlugs, opts = {}) {
    if (srcSlugs.length === 0) {
        throw new Error("merge-routes requires at least one source route");
    }
    // The destination is created from these arguments, so they get the same
    // boundary check as init's ([STORE-08]) rather than reaching save().
    assertValidSlug(newSlug);
    if (opts.group)
        assertValidSlug(opts.group, "group");
    const srcSet = new Set();
    for (const s of srcSlugs) {
        if (srcSet.has(s))
            throw new Error(`Duplicate source route: ${s}`);
        srcSet.add(s);
    }
    // Merging into an existing destination is a separate sub-flow (issue #8, out
    // of scope): the destination is always created fresh here.
    if (srcSet.has(newSlug)) {
        throw new Error(`Destination ${newSlug} cannot also be a source route`);
    }
    if (routeExists(newSlug)) {
        throw new Error(`Route already exists: ${newSlug}`);
    }
    const sources = srcSlugs.map((s) => load(s));
    // Route-level deps from outside the merge set that point at a source would
    // dangle once the source is deleted. Refuse unless --break-deps authorizes
    // repointing them at the new route (mirrors the rename referer guard).
    // Strict for the reason rename() is: an unreadable file may hold the
    // dependency this guard exists to catch.
    const externalReferers = loadAll()
        .filter((r) => !srcSet.has(r.slug) && r.depends_on?.some((d) => srcSet.has(d)))
        .map((r) => r.slug);
    if (externalReferers.length > 0 && !opts.breakDeps) {
        throw new Error(`Cannot merge: ${externalReferers.join(", ")} depend on a source route. ` +
            `Pass --break-deps to repoint those references to ${newSlug}.`);
    }
    // Order every tack across all sources chronologically: by done_at, falling
    // back to the source route's created_at for open tacks, then source created_at
    // and original numeric id as tiebreakers.
    const numId = (id) => {
        const n = parseInt(id.slice(1), 10);
        return Number.isNaN(n) ? 0 : n;
    };
    const entries = sources.flatMap((src) => src.tacks.map((tack) => ({ tack, src })));
    entries.sort((a, b) => {
        const ka = a.tack.done_at ?? a.src.created_at;
        const kb = b.tack.done_at ?? b.src.created_at;
        if (ka !== kb)
            return ka < kb ? -1 : 1;
        if (a.src.created_at !== b.src.created_at)
            return a.src.created_at < b.src.created_at ? -1 : 1;
        return numId(a.tack.id) - numId(b.tack.id);
    });
    // depends_on is route-local, so map old→new per source. Build the full map
    // before remapping, since a dep can point at a tack anywhere in its route.
    const idMapBySrc = new Map(srcSlugs.map((s) => [s, new Map()]));
    entries.forEach((e, i) => idMapBySrc.get(e.src.slug).set(e.tack.id, `t${i + 1}`));
    const newTacks = entries.map((e) => {
        const map = idMapBySrc.get(e.src.slug);
        const clone = { ...structuredClone(e.tack), id: map.get(e.tack.id) };
        if (e.tack.depends_on?.length) {
            clone.depends_on = e.tack.depends_on.map((dep) => {
                const mapped = map.get(dep);
                if (!mapped) {
                    throw new Error(`Source route ${e.src.slug} tack ${e.tack.id} depends on ${dep}, which is not in the route`);
                }
                return mapped;
            });
        }
        return clone;
    });
    // Carry sessions from every source, remapping their route-local tack refs to
    // the new IDs. A session that spanned several sources is unified: earliest
    // started_at wins and its tack refs concatenate in source order (last =
    // current focus, per recordSession). `tack remove` doesn't prune session tack
    // refs, so a ref with no mapping points at an already-removed tack — drop it
    // rather than fail the merge.
    const sessionsById = new Map();
    for (const src of sources) {
        const map = idMapBySrc.get(src.slug);
        for (const s of src.sessions ?? []) {
            const remapped = (s.tacks ?? [])
                .map((id) => map.get(id))
                .filter((id) => id !== undefined);
            const existing = sessionsById.get(s.id);
            if (!existing) {
                const session = { id: s.id, started_at: s.started_at };
                if (remapped.length)
                    session.tacks = remapped;
                sessionsById.set(s.id, session);
                continue;
            }
            if (s.started_at < existing.started_at)
                existing.started_at = s.started_at;
            for (const id of remapped) {
                if (!existing.tacks)
                    existing.tacks = [];
                const idx = existing.tacks.indexOf(id);
                if (idx !== -1)
                    existing.tacks.splice(idx, 1);
                existing.tacks.push(id);
            }
        }
    }
    const sessions = [...sessionsById.values()].sort((a, b) => a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0);
    const createdAt = opts.createdAt
        ? new Date(normalizeTimestamp(opts.createdAt)).toISOString()
        : sources.map((s) => s.created_at).sort()[0];
    const merged = {
        id: randomUUID(),
        slug: newSlug,
        created_at: createdAt,
        updated_at: now(),
        tacks: newTacks,
    };
    const group = opts.group ?? sources.find((s) => s.group)?.group;
    if (group)
        merged.group = group;
    const title = sources.find((s) => s.title)?.title;
    if (title)
        merged.title = title;
    // Descriptions are hand-written prose, so every source's body carries over
    // rather than the first one winning: the merge deletes the source files, and
    // the merged route is the only place left to rewrite them from.
    const descriptions = sources.map((s) => s.description).filter((d) => Boolean(d));
    if (descriptions.length)
        merged.description = descriptions.join("\n\n---\n\n");
    if (sessions.length)
        merged.sessions = sessions;
    // Carry the sources' outward route-deps, dropping any that pointed within the
    // merge set (those would become self-references).
    const carriedDeps = [
        ...new Set(sources.flatMap((s) => s.depends_on ?? []).filter((d) => !srcSet.has(d))),
    ];
    if (carriedDeps.length)
        merged.depends_on = carriedDeps;
    save(merged);
    const repointed = [];
    for (const slug of externalReferers) {
        const r = load(slug);
        r.depends_on = [...new Set(r.depends_on.map((d) => (srcSet.has(d) ? newSlug : d)))];
        save(r);
        repointed.push(slug);
    }
    for (const s of srcSlugs)
        remove(s);
    const report = sources.map((src) => ({
        slug: src.slug,
        moved: src.tacks.map((t) => ({
            srcId: t.id,
            dstId: idMapBySrc.get(src.slug).get(t.id),
            summary: t.summary,
        })),
    }));
    return { route: merged, sources: report, repointed };
}
export function removeTack(slug, tackId, opts = {}) {
    const route = load(slug);
    findTack(route, tackId);
    const dependents = route.tacks.filter((t) => t.id !== tackId && t.depends_on?.includes(tackId));
    if (dependents.length > 0 && !opts.force) {
        const depIds = dependents.map((t) => t.id).join(", ");
        throw new Error(`Cannot remove ${tackId}: depended on by ${depIds}. Pass --force to strip references.`);
    }
    for (const dep of dependents) {
        dep.depends_on = dep.depends_on.filter((id) => id !== tackId);
        if (dep.depends_on.length === 0)
            delete dep.depends_on;
    }
    route.tacks = route.tacks.filter((t) => t.id !== tackId);
    save(route);
    return route;
}
