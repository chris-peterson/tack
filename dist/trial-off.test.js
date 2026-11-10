import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Each installed build gets a bin/tack stub that records the root it ran from,
// so the test reads which build trial-off chose without a real install.
function installBuilds(home, versions) {
    for (const version of versions) {
        const bin = join(home, ".claude", "plugins", "cache", "chris-peterson", "tack", version, "bin");
        mkdirSync(bin, { recursive: true });
        const shim = join(bin, "tack");
        writeFileSync(shim, `#!/bin/sh\nif [ "$1" = install-cli ]; then echo "${version}" > "$HOME/restored"; else echo "tack ${version}"; fi\n`);
        chmodSync(shim, 0o755);
    }
}
function restoredVersion(versions) {
    const home = mkdtempSync(join(tmpdir(), "tack-trial-off-"));
    installBuilds(home, versions);
    execFileSync("bash", [join(repoRoot, "scripts", "trial-off.sh")], {
        encoding: "utf-8",
        env: { HOME: home, PATH: "/usr/bin:/bin" },
    });
    return readFileSync(join(home, "restored"), "utf-8").trim();
}
describe("trial-off", () => {
    it("restores the highest version, comparing the major first", () => {
        assert.equal(restoredVersion(["1.9.0", "2.0.0", "1.10.0"]), "2.0.0");
    });
    it("compares each component as a number", () => {
        assert.equal(restoredVersion(["1.9.0", "1.10.0", "1.2.0"]), "1.10.0");
    });
});
