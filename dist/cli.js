#!/usr/bin/env node
import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as route from "./route.js";
import { TACK_STATUSES } from "./types.js";
import { formatRoute, formatTack, formatList, formatRecent, formatTree, formatFind, treeData } from "./display.js";
import { ZSH_COMPLETION } from "./completions.js";
function usage() {
    console.log(`tack — route tracker for AI-assisted development

Usage:
  tack init <slug> [--group <slug>]
  tack rename <old-slug> <new-slug>
  tack status [slug] [--all]
  tack status set <slug> <tack-id> <pending|in_progress|done|blocked|dropped>
  tack list [--json]
  tack recent [--count <n>] [--since <date>] [--json]
  tack tree [path] [-d <depth>] [--json]    (path supports glob: */*/deliverable)
  tack add <slug> <summary> [--depends-on <id,...>] [--done] [--date <ts>] [--deliverable <url>]
  tack edit <slug> <tack-id> <summary>
  tack merge <slug> <source-id> <target-id>
  tack move <src-slug>/<tack-id> <dst-slug> [--include-dependents]
  tack start <slug> <tack-id>
  tack done <slug> <tack-id> [--date <ts>]
  tack drop <slug> <tack-id>
  tack remove <slug> <tack-id> [--force]
  tack deliverable <slug> <tack-id> <label> <url> [--force]
  tack before <slug> <tack-id> <text>
  tack after <slug> <tack-id> <text>
  tack todo done <slug> <tack-id> <todo-id>
  tack todo rm <slug> <tack-id> <todo-id>
  tack depends add <slug> <tack-id> <dep-id>
  tack depends rm <slug> <tack-id> <dep-id>
  tack link add <slug> <tack-id> <label> <url>
  tack link rm <slug> <tack-id> <url>
  tack session <slug> <session-id>
  tack find <url> [--json]
  tack pin [<slug>]                  Pin a route to the current cwd (no slug: show current pin)
  tack unpin                         Clear the cwd pin
  tack rm <slug> [--force]
  tack install-cli [--dir <path>]    (also installs zsh completions)
  tack completions zsh
  tack --version`);
    process.exit(1);
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
        const block = `\n${fpathLine}\nautoload -Uz compinit && compinit\n`;
        execSync(`echo '${block}' >> ${zshrc}`);
        console.log("Updated ~/.zshrc (added fpath + compinit).");
    }
    console.log("Restart your shell to activate completions.");
}
function run() {
    const args = process.argv.slice(2);
    if (args[0] === "--version" || args[0] === "-v") {
        const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ??
            resolve(fileURLToPath(import.meta.url), "..", "..");
        const manifest = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
        console.log(`tack ${manifest.version}`);
        return;
    }
    if (args.length === 0)
        usage();
    const command = args[0];
    const rest = args.slice(1);
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
            console.log(formatRoute(r));
            break;
        }
        case "status": {
            if (rest[0] === "set") {
                if (rest.length < 4)
                    usage();
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
                console.log(jsonFlag ? JSON.stringify(displayRoute, null, 2) : formatRoute(displayRoute));
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
                console.log(JSON.stringify(route.loadAll(), null, 2));
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
            const tack = route.addTack(slug, summary, {
                dependsOn,
                done: values.done,
                doneAt: values.date,
                deliverable,
            });
            console.log(formatTack(tack));
            break;
        }
        case "start": {
            if (!rest[0] || !rest[1])
                usage();
            const tack = route.startTack(rest[0], rest[1]);
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
                    console.error(`  tack deliverable ${rest[0]} ${rest[1]} "${link.label}" ${link.url}`);
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
        case "deliverable": {
            const { values: dlvValues, positionals: dlvPositionals } = parseArgs({
                args: rest,
                options: {
                    force: { type: "boolean" },
                },
                allowPositionals: true,
            });
            if (dlvPositionals.length < 4)
                usage();
            const tack = route.setDeliverable(dlvPositionals[0], dlvPositionals[1], dlvPositionals[2], dlvPositionals[3], { force: dlvValues.force });
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
                usage();
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
        case "link": {
            const sub = rest[0];
            const subArgs = rest.slice(1);
            if (sub === "add") {
                if (subArgs.length < 4)
                    usage();
                const tack = route.addLink(subArgs[0], subArgs[1], subArgs[2], subArgs[3]);
                console.log(formatTack(tack));
            }
            else if (sub === "rm") {
                if (subArgs.length < 3)
                    usage();
                const tack = route.removeLink(subArgs[0], subArgs[1], subArgs[2]);
                console.log(formatTack(tack));
            }
            else {
                usage();
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
                usage();
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
        case "session": {
            if (!rest[0] || !rest[1])
                usage();
            const r = route.recordSession(rest[0], rest[1]);
            console.log(formatRoute(r));
            break;
        }
        case "find": {
            const jsonFlag = rest.includes("--json");
            const url = rest.filter((a) => a !== "--json")[0];
            if (!url)
                usage();
            const matches = route.find(url);
            console.log(jsonFlag ? JSON.stringify(matches, null, 2) : formatFind(matches));
            break;
        }
        case "pin": {
            if (rest[0]) {
                const pin = route.writePin(rest[0]);
                console.log(`pinned ${pin.slug} → ${process.cwd()}/.tack`);
            }
            else {
                const pin = route.readPin();
                if (pin) {
                    console.log(`${pin.slug} (pinned ${pin.pinned_at})`);
                }
                else {
                    console.log("no pin set for current directory");
                    process.exit(1);
                }
            }
            break;
        }
        case "unpin": {
            const removed = route.deletePin();
            console.log(removed ? `unpinned ${process.cwd()}/.tack` : "no pin to remove");
            break;
        }
        case "rm": {
            if (!rest[0])
                usage();
            const force = rest.includes("--force");
            if (!force) {
                console.log(`Delete route ${rest[0]}? Pass --force to confirm.`);
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
run();
