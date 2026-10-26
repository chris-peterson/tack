// SERVE-23: machine-local settings, at $XDG_CONFIG_HOME/tack/config.yaml
// (default ~/.config/tack/config.yaml). The route store can be a git checkout
// cloned onto other machines, and which browser origins one machine's server
// trusts is not something a second machine should inherit.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
export function configPath() {
    return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tack", "config.yaml");
}
// An origin is scheme, host and port; a page's path or fragment is not part of
// it, and an entry carrying one would never match what a browser sends.
function isOrigin(value) {
    return URL.canParse(value) && new URL(value).origin === value;
}
export function allowedOrigins() {
    const path = configPath();
    if (!existsSync(path))
        return [];
    let data;
    try {
        data = parse(readFileSync(path, "utf-8"));
    }
    catch (e) {
        throw new Error(`${path} is not valid YAML: ${e.message}`);
    }
    if (data === null)
        return [];
    if (typeof data !== "object" || Array.isArray(data))
        throw new Error(`${path}: expected a mapping of settings`);
    const list = data.allowed_origins ?? [];
    if (!Array.isArray(list))
        throw new Error(`${path}: allowed_origins must be a list of origins`);
    for (const entry of list) {
        if (typeof entry === "string" && isOrigin(entry))
            continue;
        const hint = typeof entry === "string" && URL.canParse(entry) && new URL(entry).origin !== "null"
            ? `; use "${new URL(entry).origin}"`
            : "";
        throw new Error(`${path}: ${JSON.stringify(entry)} is not an origin (scheme://host[:port])${hint}`);
    }
    return list;
}
