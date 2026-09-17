import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * The package root, one level up from this module whether it runs as
 * `dist/build-info.js` or as `src/build-info.ts`.
 *
 * Derived from the module's own location rather than `CLAUDE_PLUGIN_ROOT`,
 * which every other version path reads: the env var names the plugin Claude
 * Code loaded, not the copy that is executing, so a wrapper pointed at a
 * working tree would report the marketplace root's answer — the same blindness
 * [HOOK-01] cites for comparing versions instead of paths.
 */
const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
function git(args) {
    try {
        return execFileSync("git", args, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 2_000,
        }).trim();
    }
    catch {
        return "";
    }
}
/**
 * Whether this copy is a working tree rather than an installed plugin. Claude
 * Code extracts a marketplace install as plain files, so a `.git` entry at the
 * package root is present in exactly one of the two. Read at the package root,
 * not the working directory, which is a git repository on most ordinary runs.
 */
export function isDevBuild() {
    return existsSync(join(PKG_ROOT, ".git"));
}
/**
 * The version to print, marking an unpublished build with the commit it came
 * from. The `g` prefix keeps the identifier valid semver: a sha of all digits
 * would read as a numeric identifier, which may not carry leading zeros. Where
 * no commit can be read the marker survives alone, since the marker is the
 * answer and the ref is the detail.
 */
export function describeVersion(version) {
    if (!isDevBuild())
        return version;
    const sha = git(["-C", PKG_ROOT, "rev-parse", "--short=7", "HEAD"]);
    if (!sha)
        return `${version}-dev`;
    const dirty = git(["-C", PKG_ROOT, "status", "--porcelain"]);
    return `${version}-dev.g${sha}${dirty ? ".dirty" : ""}`;
}
