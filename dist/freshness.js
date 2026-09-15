// Report entry points a plugin update left behind.
//
// Claude Code updates the plugin in the background, so new code arrives with no
// action from the user — while the wrapper on $PATH keeps the path it baked at
// install time. Once the old version's directory is reaped, that path reaches
// nothing.
//
// Comparing *paths* rather than `tack --version` is what makes this visible at
// all. The hook environment sets CLAUDE_PLUGIN_ROOT, and `--version` prefers it
// over the running file's own location, so a stale wrapper reads the *current*
// manifest and reports the version it is being compared against — equal at
// every amount of drift. A reaped root is worse: the wrapper then fails to run
// and the comparison has nothing to fail on, so the check went quietest exactly
// where the CLI was most broken.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Only an absolute literal path is a pin. A wrapper that execs "$DIST" — the
// plugin's own bin/tack, which computes its root from its own location — cannot
// be stale by construction, so it is not a surface this reports on.
const WRAPPER_TARGET = /^exec\s+(?:node\s+)?"(\/[^"$]+)"/m;
function home() {
    return process.env.HOME ?? process.env.USERPROFILE ?? "";
}
/** Every `tack` wrapper a shell could pick up, nearest first. */
function wrapperPaths() {
    const seen = new Set();
    const out = [];
    const add = (p) => {
        if (p && !seen.has(p)) {
            seen.add(p);
            out.push(p);
        }
    };
    for (const entry of (process.env.PATH ?? "").split(delimiter)) {
        if (entry)
            add(join(entry, "tack"));
    }
    add(join(home(), ".local", "bin", "tack"));
    return out;
}
/**
 * The entry points that belong to *this* install. A wrapper aimed at any of
 * them is current, whichever of the two forms `install-cli` wrote.
 */
function currentEntryPoints() {
    const out = [];
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
    if (pluginRoot) {
        out.push(join(pluginRoot, "bin", "tack"));
        out.push(join(pluginRoot, "dist", "cli.js"));
    }
    // The running build, for an install that never went through a plugin root.
    const here = dirname(fileURLToPath(import.meta.url));
    out.push(join(here, "cli.js"));
    return out.map((p) => resolve(p));
}
function sameFile(a, b) {
    if (resolve(a) === resolve(b))
        return true;
    try {
        return realpathSync(a) === realpathSync(b);
    }
    catch {
        return false;
    }
}
function classify(target) {
    if (!target)
        return "current";
    // Gone is gone whoever installed it: a dangling pointer is broken whether a
    // plugin update reaped it or a working copy was deleted.
    if (!existsSync(target))
        return "gone";
    const current = currentEntryPoints();
    if (current.some((p) => sameFile(target, p)))
        return "current";
    // Another version inside the plugin cache is drift a reinstall repairs.
    if (target.includes("/plugins/cache/"))
        return "stale";
    // Anything else that still exists is a working copy someone aimed here on
    // purpose — a trial [CLI-29a]. Silent while the checkout is there.
    return "dev";
}
export function surfaces() {
    const out = [];
    for (const path of wrapperPaths()) {
        if (!existsSync(path))
            continue;
        let body = "";
        try {
            body = readFileSync(path, "utf-8");
        }
        catch {
            continue;
        }
        const target = WRAPPER_TARGET.exec(body)?.[1] ?? null;
        if (!target)
            continue;
        out.push({ label: "CLI wrapper", path, target, state: classify(target) });
    }
    return out;
}
export function drift() {
    const all = surfaces();
    return {
        gone: all.filter((s) => s.state === "gone"),
        stale: all.filter((s) => s.state === "stale"),
    };
}
const REPAIR = "/tack:install-tack";
/** One line, for the channel Claude Code renders to the user. */
export function banner(d) {
    const n = d.gone.length + d.stale.length;
    const subject = n === 1 ? "the CLI wrapper" : `${n} installed entry points`;
    const verb = n === 1 ? "points" : "point";
    let what;
    if (d.gone.length && d.stale.length)
        what = "at a missing or outdated install";
    else if (d.gone.length)
        what = "at a path that no longer exists";
    else
        what = "at an older install";
    return `tack: ${subject} ${verb} ${what} — run \`${REPAIR}\` to repair. ` +
        `\`tack doctor\` names the path.`;
}
/** The per-surface breakdown, for the model. */
export function report(d) {
    const lines = [];
    for (const s of d.gone) {
        lines.push(`${s.label} ${s.path} execs ${s.target}, which does not exist.`);
    }
    for (const s of d.stale) {
        lines.push(`${s.label} ${s.path} execs ${s.target}, an older install.`);
    }
    lines.push(`Until repaired, \`tack\` invocations run stale code or fail outright. ` +
        `\`${REPAIR}\` rewrites the wrapper from the version now loaded.`);
    return lines.join(" ");
}
/**
 * The SessionStart payload, or null when every surface reaches this install.
 *
 * Both channels carry it. `additionalContext` reaches only the model, which is
 * free to answer the prompt in front of it and never mention what it read —
 * the reason this used to open by begging to be relayed, which is a request
 * rather than a mechanism. `systemMessage` is the one hook output Claude Code
 * renders to the user, so the banner is what delivers the finding and the
 * context is what tells the model why.
 */
export function sessionStartPayload() {
    const d = drift();
    if (!d.gone.length && !d.stale.length)
        return null;
    return JSON.stringify({
        systemMessage: banner(d),
        hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: report(d),
        },
    });
}
