#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as route from "./route.js";
import * as repos from "./repos.js";
import * as backup from "./backup.js";
import * as reconcile from "./reconcile.js";
import * as serve from "./serve.js";
import * as service from "./service.js";
import { TACK_STATUSES } from "./types.js";
import { formatRoute, formatTack, formatList, formatRecent, formatTree, formatFind, formatRepos, treeData } from "./display.js";
import { ZSH_COMPLETION } from "./completions.js";
function usage(exitCode = 1) {
    const print = exitCode === 0 ? console.log : console.error;
    print(`tack — route tracker for AI-assisted development

Usage:
  tack init <slug> [--group <slug>]
  tack rename <old-slug> <new-slug>
  tack group <slug> [<group>] [--clear]   (no group: show current; --clear: ungroup)
  tack title <slug> [<text>] [--clear]    (no text: show current; --clear: remove)
  tack describe <slug> [<text>] [--file <path>] [--clear]   (--file -: read markdown from stdin)
  tack status [slug] [--all]
  tack status set <slug> <tack-id> <pending|in_progress|done|blocked|dropped>
  tack list [--json]
  tack recent [--count <n>] [--since <date>] [--json]
  tack tree [path] [-d <depth>] [--json]    (path supports glob: */*/deliverable)
  tack add <slug> <summary> [--depends-on <id,...>] [--done] [--date <ts>] [--deliverable <url>] [--link "label,url"]...
  tack edit <slug> <tack-id> <summary>
  tack merge <slug> <source-id> <target-id>
  tack move <src-slug>/<tack-id> <dst-slug> [--include-dependents]
  tack merge-routes <new-slug> <src-slug>... [--group <slug>] [--created-at <date>] [--break-deps]
  tack start <slug> <tack-id>
  tack done <slug> <tack-id> [--date <ts>]
  tack drop <slug> <tack-id>
  tack reconcile [slug] [--dry-run]   Close tacks whose deliverable has merged (asks the git forge)
  tack serve [--port <n>]            Serve route documents on 127.0.0.1 (Ctrl-C to stop)
  tack serve install|uninstall|status [--port <n>]   Manage the supervised server
  tack remove <slug> <tack-id> [--force]
  tack deliverable <slug> <tack-id> <url> [--label <text>] [--force]   (label auto-derived from url by default)
  tack deliverable rm <slug> <tack-id> [--to-link]   (clear the deliverable, or --to-link to demote it into links)
  tack before <slug> <tack-id> <text>
  tack after <slug> <tack-id> <text>
  tack todo done <slug> <tack-id> <todo-id>
  tack todo rm <slug> <tack-id> <todo-id>
  tack depends add <slug> <tack-id> <dep-id>
  tack depends rm <slug> <tack-id> <dep-id>
  tack link add <slug> <tack-id> <label> <url>
  tack link rm <slug> <tack-id> <url>
  tack session <slug> <session-id> [--tack <tack-id>]
  tack find --url <url> [--json]     Find tacks referencing a URL (in any deliverable or link)
  tack find --path [<dir>] [--json]  Find routes covering a repo checkout (default cwd)
  tack repo [<partial>] [--json]     Look up repo remote(s) by name; no arg lists all
  tack repo alias <match> <alias>    Add a custom name to a repo
  tack repo prune                    Drop locals that no longer exist on disk
  tack repo rebuild                  Backfill the repo db from existing routes
  tack repo rm <match>               Remove a repo entry
  tack doctor [--json]               Report route files that will not load
  tack rm <slug> [--force]
  tack export [--out-file <path>] [--compress]  Dump a backup to stdout (routes + repos)
  tack import <file> [--merge|--replace] [--dry-run]  Merge (default) or restore a backup
  tack install-cli [--dir <path>]    (also installs zsh completions)
  tack completions zsh
  tack --version
  tack --help`);
    process.exit(exitCode);
}
// A subcommand-group verb (link, depends, todo, status) invoked without a valid
// subcommand reports the group-scoped problem on stderr instead of dumping the
// global usage to stdout — see issue #17.
function groupError(group, detail) {
    console.error(`tack ${group}: ${detail}`);
    console.error("Run `tack --help` for usage.");
    process.exit(1);
}
function expectedOneOf(expected, got) {
    const list = expected.map((s) => `'${s}'`).join(" or ");
    return got ? `expected ${list} (got '${got}')` : `expected ${list}`;
}
// A route description is markdown, so it arrives from a file or a pipe as often
// as from an inline argument. Trailing newlines are stripped so `--file` and an
// equivalent inline argument store the same value (CLI-54a).
function readDescriptionBody(file) {
    const raw = file === "-" ? readFileSync(0, "utf-8") : readFileSync(file, "utf-8");
    return raw.replace(/\n+$/, "");
}
// Warn (to stderr) when a URL being attached already lives on another tack, so
// the caller can spot a duplicate before a downstream tool double-counts it.
function warnUrlCollision(url, slug, tackId) {
    const collisions = route.findCollisions(url, { slug, tackId });
    if (collisions.length === 0)
        return;
    const locations = collisions.map((m) => `${m.slug}/${m.tackId} (${m.match})`).join(", ");
    console.error(`warning: url already on ${locations}: ${url}`);
}
// Attribute the current Claude session to a route it just touched, so fleet
// views can see which session is driving the work. A no-op outside a Claude
// session (the env var is unset in an ad-hoc terminal). `init` and `add` record
// route-level (a session that created a route/tack is working that route);
// `start` additionally binds the specific tack it just started.
function recordSessionIfPresent(slug, tackId) {
    const sid = process.env.CLAUDE_CODE_SESSION_ID;
    if (sid)
        route.recordSession(slug, sid, tackId);
}
function resolveSource() {
    // Plugin install: prefer the bash shim that lazy-builds dist on first run.
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
    if (pluginRoot) {
        const shim = join(pluginRoot, "bin", "tack");
        if (existsSync(shim))
            return { path: shim, kind: "shim" };
    }
    // npm install: point at the running cli.js directly.
    return { path: fileURLToPath(import.meta.url), kind: "node" };
}
function pathContains(targetDir) {
    const target = resolve(targetDir);
    const entries = (process.env.PATH ?? "").split(delimiter);
    for (const entry of entries) {
        if (!entry)
            continue;
        try {
            if (resolve(entry) === target)
                return true;
        }
        catch {
            continue;
        }
    }
    return false;
}
function installCli(dir) {
    const source = resolveSource();
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const targetDir = dir ? resolve(dir) : join(home, ".local", "bin");
    const target = join(targetDir, "tack");
    mkdirSync(targetDir, { recursive: true });
    const wrapper = source.kind === "shim"
        ? `#!/usr/bin/env bash\nexec "${source.path}" "$@"\n`
        : `#!/usr/bin/env bash\nexec node "${source.path}" "$@"\n`;
    let existing = null;
    try {
        existing = readFileSync(target, "utf-8");
    }
    catch { }
    if (existing === wrapper) {
        console.log(`already installed: ${target} -> ${source.path}`);
    }
    else {
        writeFileSync(target, wrapper);
        chmodSync(target, 0o755);
        console.log(`installed: ${target} -> ${source.path}`);
    }
    if (!pathContains(targetDir)) {
        console.log(`warning: ${targetDir} is not on $PATH — add it to your shell rc`);
    }
    installZshCompletions();
}
function installZshCompletions() {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const zshrc = join(home, ".zshrc");
    const dir = join(home, ".zsh", "completions");
    const file = join(dir, "_tack");
    mkdirSync(dir, { recursive: true });
    let existing = null;
    try {
        existing = readFileSync(file, "utf-8");
    }
    catch { }
    if (existing === ZSH_COMPLETION) {
        console.log(`completions already installed: ${file}`);
    }
    else {
        writeFileSync(file, ZSH_COMPLETION);
        console.log(`completions installed: ${file}`);
    }
    let zshrcContent = "";
    try {
        zshrcContent = readFileSync(zshrc, "utf-8");
    }
    catch { }
    const hasFpath = zshrcContent.includes(".zsh/completions");
    const hasCompinit = zshrcContent.includes("compinit");
    const fpathLine = `fpath=(~/.zsh/completions $fpath)`;
    if (!hasFpath && hasCompinit) {
        const updated = zshrcContent.replace(/(.*compinit.*)/, `${fpathLine}\n$1`);
        writeFileSync(zshrc, updated);
        console.log("Updated ~/.zshrc (added fpath before compinit).");
    }
    else if (!hasFpath && !hasCompinit) {
        // Appended with writeFileSync like the branch above, never through a shell.
        // `zshrc` is built from $HOME, and interpolating it into a command string
        // let any metacharacter in $HOME run as a command — and broke the append
        // outright for the ordinary case of a home directory containing a space.
        const block = `\n${fpathLine}\nautoload -Uz compinit && compinit\n`;
        writeFileSync(zshrc, zshrcContent + block);
        console.log("Updated ~/.zshrc (added fpath + compinit).");
    }
    console.log("Restart your shell to activate completions.");
}
function readVersion() {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ??
        resolve(fileURLToPath(import.meta.url), "..", "..");
    try {
        const manifest = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
        return manifest.version;
    }
    catch {
        return "unknown";
    }
}
// Everything the CLI throws is an ordinary caller condition — an unknown flag,
// a slug that doesn't exist, a schema rule the write would break — so the
// message is the whole of what the caller can act on. Set TACK_DEBUG to get the
// stack back when the throw is a genuine bug rather than a refusal.
function fail(e) {
    const err = e;
    if (process.env.TACK_DEBUG) {
        console.error(err?.stack ?? String(e));
    }
    else {
        console.error(`tack: ${err?.message ?? String(e)}`);
        // parseArgs names the offending flag but not where to look it up.
        if (err?.code?.startsWith("ERR_PARSE_ARGS_"))
            console.error("Run `tack --help` for usage.");
    }
    process.exit(1);
}
function run() {
    const args = process.argv.slice(2);
    if (args[0] === "--version" || args[0] === "-v") {
        console.log(`tack ${readVersion()}`);
        return;
    }
    if (args[0] === "--help" || args[0] === "-h" || args[0] === "help")
        usage(0);
    if (args.length === 0)
        usage();
    const command = args[0];
    const rest = args.slice(1);
    // `--help`/`-h` after any subcommand shows usage, mirroring bare `tack
    // --help`. Without this, subcommands parsed with strict parseArgs throw on
    // the unknown flag and manual-parse ones (list, status) silently
    // ignore it and run anyway.
    if (rest.includes("--help") || rest.includes("-h"))
        usage(0);
    switch (command) {
        case "init": {
            if (!rest[0])
                usage();
            const { values: initValues } = parseArgs({
                args: rest,
                options: {
                    group: { type: "string" },
                },
                allowPositionals: true,
            });
            const slug = rest.filter((a) => !a.startsWith("--"))[0];
            const r = route.init(slug, {
                group: initValues.group,
            });
            recordSessionIfPresent(slug);
            console.log(formatRoute(r));
            break;
        }
        case "status": {
            if (rest[0] === "set") {
                if (rest.length < 4)
                    groupError("status set", "expected <slug> <tack-id> <status>");
                if (!TACK_STATUSES.includes(rest[3])) {
                    console.error(`Invalid status: ${rest[3]} (expected one of: ${TACK_STATUSES.join(", ")})`);
                    process.exit(1);
                }
                const tack = route.setStatus(rest[1], rest[2], rest[3]);
                console.log(formatTack(tack));
                break;
            }
            const jsonFlag = rest.includes("--json");
            const allFlag = rest.includes("--all");
            const slug = rest.filter((a) => a !== "--json" && a !== "--all")[0];
            if (slug) {
                const r = route.load(slug);
                const displayRoute = allFlag
                    ? r
                    : { ...r, tacks: r.tacks.filter((t) => t.status !== "dropped") };
                // `state` rides on the JSON rendering only — it is derived from the
                // tacks and the schema closes the route object, so writing it back
                // would fail validation.
                console.log(jsonFlag
                    ? JSON.stringify({ ...displayRoute, state: route.routeState(r) }, null, 2)
                    : formatRoute(displayRoute, { linkBase: serve.hyperlinkBase() }));
            }
            else {
                const routes = route.list();
                console.log(jsonFlag ? JSON.stringify(routes, null, 2) : formatList(routes));
            }
            break;
        }
        case "list": {
            const jsonFlag = rest.includes("--json");
            if (jsonFlag) {
                const routes = route.scanAll().map((r) => ({ ...r, state: route.routeState(r) }));
                console.log(JSON.stringify(routes, null, 2));
            }
            else {
                console.log(formatList(route.list()));
            }
            break;
        }
        case "recent": {
            const { values: recentValues } = parseArgs({
                args: rest,
                options: {
                    count: { type: "string" },
                    since: { type: "string" },
                    json: { type: "boolean" },
                },
                allowPositionals: true,
            });
            const count = recentValues.count ? parseInt(recentValues.count, 10) : undefined;
            const since = recentValues.since;
            const recentRoutes = route.recent({ count, since });
            console.log(recentValues.json
                ? JSON.stringify(recentRoutes, null, 2)
                : formatRecent(recentRoutes));
            break;
        }
        case "tree": {
            const { values: treeValues } = parseArgs({
                args: rest,
                options: {
                    depth: { type: "string", short: "d" },
                    json: { type: "boolean" },
                },
                allowPositionals: true,
            });
            const treePath = rest.filter((a) => !a.startsWith("-") && a !== treeValues.depth)[0];
            const depth = treeValues.depth ? parseInt(treeValues.depth, 10) : undefined;
            const hasGlob = treePath && (treePath.includes("*") || treePath.includes("?"));
            const slugs = !treePath || hasGlob
                ? route.list().map((r) => r.slug)
                : [treePath.split("/")[0]];
            const routes = slugs.map((s) => route.load(s));
            console.log(treeValues.json
                ? JSON.stringify(treeData(routes, treePath), null, 2)
                : formatTree(routes, treePath, depth));
            break;
        }
        case "add": {
            if (!rest[0] || !rest[1])
                usage();
            const slug = rest[0];
            const summary = rest[1];
            const { values } = parseArgs({
                args: rest.slice(2),
                options: {
                    "depends-on": { type: "string" },
                    done: { type: "boolean" },
                    date: { type: "string" },
                    deliverable: { type: "string" },
                    link: { type: "string", multiple: true },
                },
                allowPositionals: true,
            });
            const dependsOn = values["depends-on"]
                ? values["depends-on"].split(",")
                : undefined;
            const deliverableUrl = values.deliverable;
            const deliverable = deliverableUrl
                ? { label: route.deriveDeliverableLabel(deliverableUrl), url: deliverableUrl }
                : undefined;
            // Each --link is "label,url", and commas occur on both sides: labels carry
            // them in enumerations and clauses, URLs in query values (?ids=1,2). So
            // split at the first comma whose suffix parses as a URL rather than at a
            // fixed one — the label keeps its commas, and so does the URL.
            const links = values.link?.map((spec) => {
                for (let i = spec.indexOf(","); i >= 0; i = spec.indexOf(",", i + 1)) {
                    const url = spec.slice(i + 1);
                    if (URL.canParse(url))
                        return { label: spec.slice(0, i), url };
                }
                console.error(`Invalid --link "${spec}": expected "label,url" where url is absolute ` +
                    `(e.g. "docs,https://example.com/x").`);
                process.exit(1);
            });
            const tack = route.addTack(slug, summary, {
                dependsOn,
                done: values.done,
                doneAt: values.date,
                deliverable,
                links,
            });
            if (deliverableUrl)
                warnUrlCollision(deliverableUrl, slug, tack.id);
            for (const link of tack.links ?? [])
                warnUrlCollision(link.url, slug, tack.id);
            recordSessionIfPresent(slug);
            console.log(formatTack(tack));
            break;
        }
        case "start": {
            if (!rest[0] || !rest[1])
                usage();
            const tack = route.startTack(rest[0], rest[1]);
            // Bind the current Claude session to the tack it just started, so the
            // fleet view (beacon reads sessions[].tacks) attributes the session to
            // the tack it is driving with no separate `tack session --tack` call.
            recordSessionIfPresent(rest[0], rest[1]);
            console.log(formatTack(tack));
            break;
        }
        case "done": {
            if (!rest[0] || !rest[1])
                usage();
            const { values: doneValues } = parseArgs({
                args: rest.slice(2),
                options: {
                    date: { type: "string" },
                },
                allowPositionals: true,
            });
            const { tack, pendingTodo, ambiguousDeliverable } = route.markDone(rest[0], rest[1], {
                at: doneValues.date,
            });
            console.log(formatTack(tack));
            if (pendingTodo.length) {
                console.log("\nPending todo items:");
                for (const text of pendingTodo) {
                    console.log(`  [ ] ${text}`);
                }
            }
            if (ambiguousDeliverable.length) {
                console.error(`\nMultiple PR/MR links present — no deliverable promoted. Pick one with:`);
                for (const link of ambiguousDeliverable) {
                    console.error(`  tack deliverable ${rest[0]} ${rest[1]} ${link.url} --label "${link.label}"`);
                }
            }
            break;
        }
        case "drop": {
            if (!rest[0] || !rest[1])
                usage();
            const tack = route.markDropped(rest[0], rest[1]);
            console.log(formatTack(tack));
            break;
        }
        case "serve": {
            const { values: serveValues, positionals: servePositionals } = parseArgs({
                args: rest,
                options: { port: { type: "string" } },
                allowPositionals: true,
            });
            const port = serveValues.port ? parseInt(serveValues.port, 10) : serve.DEFAULT_PORT;
            if (Number.isNaN(port)) {
                groupError("serve", `--port expects a number (got '${serveValues.port}')`);
            }
            const sub = servePositionals[0];
            if (sub === "install") {
                service.install(port);
            }
            else if (sub === "uninstall") {
                service.uninstall();
            }
            else if (sub === "status") {
                service.status(port);
            }
            else if (sub) {
                groupError("serve", expectedOneOf(["install", "uninstall", "status"], sub));
            }
            else {
                serve.serve(port);
                console.log(`tack serve → http://127.0.0.1:${port}/  (Ctrl-C to stop)`);
            }
            break;
        }
        case "reconcile": {
            const { values: recValues, positionals: recPositionals } = parseArgs({
                args: rest,
                options: { "dry-run": { type: "boolean" } },
                allowPositionals: true,
            });
            const dryRun = Boolean(recValues["dry-run"]);
            const closed = reconcile.reconcile({ slug: recPositionals[0], dryRun });
            if (closed.length === 0) {
                console.log("Nothing to close — no open tack has a merged deliverable.");
                break;
            }
            const tag = dryRun ? "[dry-run] " : "";
            for (const c of closed) {
                console.log(`${tag}${c.slug}/${c.tackId} done [${c.mergedAt}]  ${c.summary}`);
            }
            break;
        }
        case "deliverable": {
            // `deliverable` is a set-verb by default; the `rm` subcommand clears or
            // (with --to-link) demotes the deliverable, matching link/depends/todo.
            if (rest[0] === "rm") {
                const { values: rmValues, positionals: rmPositionals } = parseArgs({
                    args: rest.slice(1),
                    options: {
                        "to-link": { type: "boolean" },
                    },
                    allowPositionals: true,
                });
                if (rmPositionals.length !== 2)
                    usage();
                const tack = route.removeDeliverable(rmPositionals[0], rmPositionals[1], {
                    toLink: rmValues["to-link"],
                });
                console.log(formatTack(tack));
                break;
            }
            const { values: dlvValues, positionals: dlvPositionals } = parseArgs({
                args: rest,
                options: {
                    force: { type: "boolean" },
                    label: { type: "string" },
                },
                allowPositionals: true,
            });
            if (dlvPositionals.length !== 3)
                usage();
            // <slug> <tack-id> <url>; the label is auto-derived from the url, and
            // --label overrides it for the occasional case the default doesn't fit.
            const dlvUrl = dlvPositionals[2];
            const dlvLabel = dlvValues.label ?? route.deriveDeliverableLabel(dlvUrl);
            const tack = route.setDeliverable(dlvPositionals[0], dlvPositionals[1], dlvLabel, dlvUrl, { force: dlvValues.force });
            warnUrlCollision(dlvUrl, dlvPositionals[0], tack.id);
            console.log(formatTack(tack));
            break;
        }
        case "before": {
            if (rest.length < 3)
                usage();
            const tack = route.addBefore(rest[0], rest[1], rest[2]);
            console.log(formatTack(tack));
            break;
        }
        case "after": {
            if (rest.length < 3)
                usage();
            const tack = route.addAfter(rest[0], rest[1], rest[2]);
            console.log(formatTack(tack));
            break;
        }
        case "todo": {
            const subcommand = rest[0];
            if (subcommand === "done") {
                if (rest.length < 4)
                    usage();
                const tack = route.completeTodo(rest[1], rest[2], rest[3]);
                console.log(formatTack(tack));
            }
            else if (subcommand === "rm") {
                if (rest.length < 4)
                    usage();
                const tack = route.dropTodo(rest[1], rest[2], rest[3]);
                console.log(formatTack(tack));
            }
            else {
                groupError("todo", expectedOneOf(["done", "rm"], subcommand));
            }
            break;
        }
        case "edit": {
            if (rest.length < 3)
                usage();
            const tack = route.editTack(rest[0], rest[1], rest[2]);
            console.log(formatTack(tack));
            break;
        }
        case "merge": {
            if (rest.length < 3)
                usage();
            const tack = route.mergeTacks(rest[0], rest[1], rest[2]);
            console.log(formatTack(tack));
            break;
        }
        case "move": {
            const { values: moveValues, positionals: movePositionals } = parseArgs({
                args: rest,
                options: {
                    "include-dependents": { type: "boolean" },
                },
                allowPositionals: true,
            });
            if (movePositionals.length < 2)
                usage();
            const srcPath = movePositionals[0];
            const dstSlug = movePositionals[1];
            const parts = srcPath.split("/");
            if (parts.length !== 2 || !parts[0] || !parts[1]) {
                console.error(`Invalid source path: ${srcPath} (expected <src-slug>/<tack-id>)`);
                process.exit(1);
            }
            const result = route.moveTack(parts[0], parts[1], dstSlug, {
                includeDependents: moveValues["include-dependents"],
            });
            const lines = result.moved.map((m) => `  ${parts[0]}/${m.srcId} → ${dstSlug}/${m.dstId}: ${m.summary}`);
            console.log(`Moved ${result.moved.length} tack(s):`);
            console.log(lines.join("\n"));
            console.log("");
            console.log(formatRoute(result.dstRoute));
            break;
        }
        case "merge-routes": {
            const { values: mergeValues, positionals: mergePositionals } = parseArgs({
                args: rest,
                options: {
                    group: { type: "string" },
                    "created-at": { type: "string" },
                    "break-deps": { type: "boolean" },
                },
                allowPositionals: true,
            });
            if (mergePositionals.length < 2)
                usage();
            const [newSlug, ...srcSlugs] = mergePositionals;
            const result = route.mergeRoutes(newSlug, srcSlugs, {
                group: mergeValues.group,
                createdAt: mergeValues["created-at"],
                breakDeps: mergeValues["break-deps"],
            });
            recordSessionIfPresent(newSlug);
            const total = result.sources.reduce((n, s) => n + s.moved.length, 0);
            console.log(`Merged ${result.sources.length} route(s), ${total} tack(s) → ${newSlug}:`);
            for (const s of result.sources) {
                for (const m of s.moved) {
                    console.log(`  ${s.slug}/${m.srcId} → ${newSlug}/${m.dstId}: ${m.summary}`);
                }
            }
            if (result.repointed.length > 0) {
                console.log(`Repointed depends_on → ${newSlug} on: ${result.repointed.join(", ")}`);
            }
            console.log("");
            console.log(formatRoute(result.route));
            break;
        }
        case "link": {
            const sub = rest[0];
            const subArgs = rest.slice(1);
            if (sub === "add") {
                if (subArgs.length < 4)
                    usage();
                const tack = route.addLink(subArgs[0], subArgs[1], subArgs[2], subArgs[3]);
                warnUrlCollision(subArgs[3], subArgs[0], tack.id);
                console.log(formatTack(tack));
            }
            else if (sub === "rm") {
                if (subArgs.length < 3)
                    usage();
                const tack = route.removeLink(subArgs[0], subArgs[1], subArgs[2]);
                console.log(formatTack(tack));
            }
            else {
                groupError("link", expectedOneOf(["add", "rm"], sub));
            }
            break;
        }
        case "depends": {
            const sub = rest[0];
            const subArgs = rest.slice(1);
            if (sub === "add") {
                if (subArgs.length < 3)
                    usage();
                const tack = route.addDependency(subArgs[0], subArgs[1], subArgs[2]);
                console.log(formatTack(tack));
            }
            else if (sub === "rm") {
                if (subArgs.length < 3)
                    usage();
                const tack = route.removeDependency(subArgs[0], subArgs[1], subArgs[2]);
                console.log(formatTack(tack));
            }
            else {
                groupError("depends", expectedOneOf(["add", "rm"], sub));
            }
            break;
        }
        case "rename": {
            if (!rest[0] || !rest[1])
                usage();
            const r = route.rename(rest[0], rest[1]);
            console.log(`Renamed: ${rest[0]} → ${rest[1]}`);
            console.log(formatRoute(r));
            break;
        }
        case "group": {
            const { values: groupValues, positionals: groupPositionals } = parseArgs({
                args: rest,
                options: {
                    clear: { type: "boolean" },
                },
                allowPositionals: true,
            });
            const groupSlug = groupPositionals[0];
            if (!groupSlug)
                usage();
            if (groupValues.clear) {
                const r = route.clearGroup(groupSlug);
                console.log(`Cleared group on ${groupSlug}`);
                console.log(formatRoute(r));
            }
            else if (groupPositionals[1]) {
                const r = route.setGroup(groupSlug, groupPositionals[1]);
                console.log(formatRoute(r));
            }
            else {
                // No group argument: report the current group.
                const r = route.load(groupSlug);
                if (r.group) {
                    console.log(r.group);
                }
                else {
                    console.log(`no group set on ${groupSlug}`);
                    process.exit(1);
                }
            }
            break;
        }
        case "title": {
            const { values: titleValues, positionals: titlePositionals } = parseArgs({
                args: rest,
                options: {
                    clear: { type: "boolean" },
                },
                allowPositionals: true,
            });
            const titleSlug = titlePositionals[0];
            if (!titleSlug)
                usage();
            if (titleValues.clear) {
                const r = route.clearTitle(titleSlug);
                console.log(`Cleared title on ${titleSlug}`);
                console.log(formatRoute(r));
            }
            else if (titlePositionals[1]) {
                const r = route.setTitle(titleSlug, titlePositionals[1]);
                console.log(formatRoute(r));
            }
            else {
                // No text argument: report the current title, mirroring `tack group`.
                const r = route.load(titleSlug);
                if (r.title) {
                    console.log(r.title);
                }
                else {
                    console.log(`no title set on ${titleSlug}`);
                    process.exit(1);
                }
            }
            break;
        }
        case "describe": {
            const { values: describeValues, positionals: describePositionals } = parseArgs({
                args: rest,
                options: {
                    clear: { type: "boolean" },
                    file: { type: "string" },
                },
                allowPositionals: true,
            });
            const describeSlug = describePositionals[0];
            if (!describeSlug)
                usage();
            const describeFile = describeValues.file;
            if (describeFile !== undefined && describePositionals[1]) {
                groupError("describe", "pass either <text> or --file <path>, not both.");
            }
            if (describeValues.clear) {
                const r = route.clearDescription(describeSlug);
                console.log(`Cleared description on ${describeSlug}`);
                console.log(formatRoute(r));
            }
            else if (describeFile !== undefined || describePositionals[1]) {
                const body = describeFile !== undefined
                    ? readDescriptionBody(describeFile)
                    : describePositionals[1];
                // An empty body is a truncated pipe far more often than an intent to
                // remove the field, and storing "" leaves a description the show branch
                // then reports as unset. `--clear` is the way to remove one.
                if (body === "") {
                    groupError("describe", `${describeFile === "-" ? "stdin" : describeFile} is empty; use --clear to remove the description.`);
                }
                const r = route.setDescription(describeSlug, body);
                console.log(formatRoute(r));
            }
            else {
                const r = route.load(describeSlug);
                if (r.description) {
                    console.log(r.description);
                }
                else {
                    console.log(`no description set on ${describeSlug}`);
                    process.exit(1);
                }
            }
            break;
        }
        case "session": {
            const { values: sessionValues, positionals: sessionPositionals } = parseArgs({
                args: rest,
                options: { tack: { type: "string" } },
                allowPositionals: true,
            });
            if (!sessionPositionals[0] || !sessionPositionals[1])
                usage();
            const r = route.recordSession(sessionPositionals[0], sessionPositionals[1], sessionValues.tack);
            console.log(formatRoute(r));
            break;
        }
        case "find": {
            // Two symmetric selectors, exactly one required: --url matches a forge URL
            // against deliverables/links; --path [<dir>] (default cwd) resolves a
            // checkout's origin remote to a repo key and matches routes in that repo.
            // Both render through formatFind / --json identically.
            const jsonFlag = rest.includes("--json");
            const args = rest.filter((a) => a !== "--json");
            const urlIdx = args.indexOf("--url");
            const pathIdx = args.indexOf("--path");
            if ((urlIdx === -1) === (pathIdx === -1)) {
                groupError("find", "pass exactly one of --url <url> or --path [<dir>].");
            }
            if (urlIdx !== -1) {
                const url = args[urlIdx + 1];
                if (!url)
                    groupError("find", "--url requires a url.");
                const matches = route.find(url);
                console.log(jsonFlag ? JSON.stringify(matches, null, 2) : formatFind(matches));
                break;
            }
            const dir = args[pathIdx + 1] ?? process.cwd();
            const key = repos.repoKeyForCwd(dir);
            const matches = key ? route.findByRepoKey(key) : [];
            if (jsonFlag) {
                console.log(JSON.stringify(matches, null, 2));
            }
            else if (!key) {
                console.log(`No git repo with an origin remote at ${dir}.`);
            }
            else {
                console.log(matches.length ? formatFind(matches) : `No tacks reference repo ${key}.`);
            }
            break;
        }
        case "repo": {
            const sub = rest[0];
            const subArgs = rest.slice(1);
            if (sub === "alias") {
                if (subArgs.length < 2)
                    usage();
                const m = repos.addAlias(subArgs[0], subArgs[1]);
                console.log(formatRepos([m]));
            }
            else if (sub === "prune") {
                const removed = repos.pruneLocals();
                if (removed.length === 0) {
                    console.log("nothing to prune");
                }
                else {
                    for (const r of removed)
                        console.log(`pruned ${r.path} (${r.key})`);
                }
            }
            else if (sub === "rebuild") {
                const r = route.rebuildRepos();
                console.log(`rebuilt repos.yaml: ${r.repoCount} repos (${r.urlsMatched} forge URLs across routes)`);
            }
            else if (sub === "rm") {
                if (!subArgs[0])
                    usage();
                const m = repos.removeRepo(subArgs[0]);
                console.log(`Removed: ${m.key}`);
            }
            else {
                const jsonFlag = rest.includes("--json");
                const partial = rest.filter((a) => !a.startsWith("--"))[0];
                if (partial) {
                    const matches = repos.matchByName(partial);
                    if (matches.length === 0) {
                        console.error(`No repo matches "${partial}"`);
                        process.exit(1);
                    }
                    if (jsonFlag)
                        console.log(JSON.stringify(matches, null, 2));
                    else if (matches.length === 1)
                        console.log(matches[0].url);
                    else
                        console.log(formatRepos(matches));
                }
                else {
                    const all = repos.listRepos();
                    console.log(jsonFlag ? JSON.stringify(all, null, 2) : formatRepos(all));
                }
            }
            break;
        }
        case "rm": {
            if (!rest[0])
                usage();
            const force = rest.includes("--force");
            if (!force) {
                // The refusal is not route data, so it goes to stderr with the other
                // group-scoped errors ([CLI-41]) — a caller redirecting stdout gets no
                // output at all, which is accurate: nothing was deleted.
                console.error(`Delete route ${rest[0]}? Pass --force to confirm.`);
                process.exit(1);
            }
            route.remove(rest[0]);
            console.log(`Deleted: ${rest[0]}`);
            break;
        }
        case "remove": {
            if (!rest[0] || !rest[1])
                usage();
            const force = rest.includes("--force");
            const r = route.removeTack(rest[0], rest[1], { force });
            console.log(`Removed: ${rest[0]}/${rest[1]}`);
            console.log(formatRoute(r));
            break;
        }
        case "export": {
            const { values } = parseArgs({
                args: rest,
                options: {
                    "out-file": { type: "string" },
                    compress: { type: "boolean" },
                },
                allowPositionals: false,
            });
            const { json, counts } = backup.buildArchive(`tack ${readVersion()}`);
            const compress = Boolean(values.compress);
            const payload = compress ? backup.compress(json) : json;
            const outFile = values["out-file"];
            if (outFile) {
                writeFileSync(outFile, payload);
                const size = Buffer.byteLength(payload);
                console.error(`exported ${counts.routes} routes, ${counts.repos} repos → ${outFile} ` +
                    `(${(size / 1024).toFixed(1)} KB${compress ? ", gzip" : ""}, schema v${backup.SCHEMA_VERSION})`);
            }
            else {
                process.stdout.write(payload);
                if (!compress)
                    process.stdout.write("\n");
            }
            break;
        }
        case "import": {
            const { values, positionals } = parseArgs({
                args: rest,
                options: {
                    merge: { type: "boolean" },
                    replace: { type: "boolean" },
                    "dry-run": { type: "boolean" },
                },
                allowPositionals: true,
            });
            if (!positionals[0])
                usage();
            if (values.merge && values.replace) {
                console.error("tack import: choose one of --merge or --replace");
                process.exit(1);
            }
            const mode = values.replace ? "replace" : "merge";
            const dryRun = Boolean(values["dry-run"]);
            let archive;
            try {
                archive = backup.parseArchive(readFileSync(positionals[0]));
            }
            catch (e) {
                console.error(`tack import: ${e.message}`);
                process.exit(1);
            }
            const r = backup.applyImport(archive, { mode, dryRun });
            const tag = dryRun ? "[dry-run] " : "";
            console.log(`${tag}import (${mode}) from schema v${archive.schemaVersion}, exported ${archive.exportedAt}`);
            if (mode === "replace") {
                console.log(`${tag}restored ${r.created.length + r.replaced.length} routes ` +
                    `(${r.created.length} new, ${r.replaced.length} overwritten), ` +
                    `${r.reposKeysAdded} repos`);
            }
            else {
                const added = r.merged.reduce((s, m) => s + m.added, 0);
                console.log(`${tag}created ${r.created.length} routes; merged ${r.merged.length} ` +
                    `(${added} tacks added); repos +${r.reposKeysAdded} keys / +${r.reposNamesAdded} names`);
                if (r.created.length)
                    console.log(`  created: ${r.created.join(", ")}`);
                for (const m of r.merged) {
                    if (!m.reassignments.length)
                        continue;
                    console.log(`  ${m.slug}: +${m.added} added, ${m.skipped} already present`);
                    for (const ra of m.reassignments) {
                        console.log(`    ${ra.from} → ${ra.to}  ${ra.summary}`);
                    }
                }
            }
            break;
        }
        case "doctor": {
            const report = route.doctor();
            if (rest.includes("--json")) {
                console.log(JSON.stringify(report, null, 2));
            }
            else {
                const files = `${report.files} route file${report.files === 1 ? "" : "s"}`;
                if (report.invalid.length === 0) {
                    console.log(`${files}, all readable`);
                }
                else {
                    console.log(`${files}, ${report.invalid.length} could not be read\n`);
                    for (const r of report.invalid) {
                        console.log(`${r.slug}.yaml — ${r.file}`);
                        for (const e of r.errors)
                            console.log(`  ${e}`);
                        console.log("");
                    }
                    console.log("Repair each file listed above by hand, then re-run `tack doctor`.");
                }
            }
            if (report.invalid.length > 0)
                process.exitCode = 1;
            break;
        }
        case "install-cli": {
            const { values } = parseArgs({
                args: rest,
                options: { dir: { type: "string" } },
                allowPositionals: true,
            });
            installCli(values.dir);
            break;
        }
        case "completions": {
            const shell = rest[0];
            if (shell === "zsh") {
                installZshCompletions();
            }
            else {
                console.error(shell ? `Unsupported shell: ${shell}` : "Usage: tack completions <shell>");
                console.error("Supported shells: zsh");
                process.exit(1);
            }
            break;
        }
        default:
            console.error(`Unknown command: ${command}`);
            usage();
    }
}
// Issue #49: a route file the scan could not read is missing from whatever the
// command just printed. Name it, and exit non-zero — the answer is incomplete,
// and a caller reading only the exit code has no other way to learn that.
function reportInvalidRoutes() {
    const invalid = route.invalidRoutes();
    if (invalid.length === 0)
        return;
    const n = invalid.length;
    console.error(`\ntack: ${n} route file${n === 1 ? "" : "s"} could not be read ` +
        `and ${n === 1 ? "was" : "were"} left out:`);
    for (const r of invalid) {
        console.error(`  ${r.slug}.yaml`);
        for (const e of r.errors)
            console.error(`    ${e}`);
    }
    console.error("Run `tack doctor` for the full report.");
    process.exitCode = 1;
}
try {
    run();
    reportInvalidRoutes();
}
catch (e) {
    fail(e);
}
