import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ZSH_PROMPT } from "./prompt.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const zsh = spawnSync("zsh", ["-f", "-c", "exit 0"]).status === 0;
function checkout(dir, remote) {
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
}
// The integration is zsh code run on every cd, so it is checked by sourcing it
// into zsh and reading back what it set.
describe("the zsh prompt integration (CLI-61)", { skip: !zsh }, () => {
    const home = mkdtempSync(join(tmpdir(), "tack-prompt-"));
    const tackHome = join(home, ".tack");
    mkdirSync(tackHome);
    writeFileSync(join(tackHome, "repos.yaml"), "gitlab.example.com/globex/ai-tools:\n  names: [ai-tools]\n");
    const repo = join(home, "src", "ai-tools");
    checkout(repo, "git@gitlab.example.com:acme/ai-tools.git");
    mkdirSync(join(repo, "lib", "50%"), { recursive: true });
    const elsewhere = join(home, "notes");
    mkdirSync(elsewhere);
    const snippet = join(home, "tack-prompt.zsh");
    writeFileSync(snippet, ZSH_PROMPT);
    // Each line names a directory to cd into; the harness prints what the hook set.
    function promptDirs(dirs, path) {
        const harness = join(home, "harness.zsh");
        writeFileSync(harness, [`source ${snippet}`, ...dirs.map((d) => `cd ${JSON.stringify(d)} && print -r -- "$TACK_PROMPT_DIR"`)].join("\n"));
        const out = execFileSync("zsh", ["-f", harness], {
            cwd: home,
            encoding: "utf-8",
            env: { HOME: home, TACK_HOME: tackHome, PATH: path },
        });
        return out.trimEnd().split("\n");
    }
    const tackOnPath = `${join(root, "bin")}:${process.env.PATH}`;
    test("names a checkout by its label, followed by the path inside it", () => {
        assert.deepEqual(promptDirs([repo, join(repo, "lib")], tackOnPath), ["acme/ai-tools", "acme/ai-tools/lib"]);
    });
    test("shows the working directory outside a checkout and inside .git", () => {
        assert.deepEqual(promptDirs([elsewhere, join(repo, ".git")], tackOnPath), ["~/notes", "~/src/ai-tools/.git"]);
    });
    test("doubles a % in a folder name so PROMPT shows it literally", () => {
        assert.deepEqual(promptDirs([join(repo, "lib", "50%")], tackOnPath), ["acme/ai-tools/lib/50%%"]);
    });
    test("falls back to the checkout's folder name when tack is not on PATH", () => {
        const bare = `${dirname(execFileSync("which", ["git"], { encoding: "utf-8" }).trim())}:/usr/bin:/bin`;
        assert.deepEqual(promptDirs([join(repo, "lib")], bare), ["ai-tools/lib"]);
    });
});
describe("install-cli --prompt (CLI-61a)", () => {
    function install(home, ...args) {
        execFileSync("node", [cli, "install-cli", ...args], {
            encoding: "utf-8",
            env: { ...process.env, HOME: home, TACK_HOME: join(home, ".tack") },
        });
    }
    const sourceLines = (home) => readFileSync(join(home, ".zshrc"), "utf-8").split("\n").filter((l) => l === "source ~/.zsh/tack-prompt.zsh");
    test("installs the integration and sources it from ~/.zshrc once", () => {
        const home = mkdtempSync(join(tmpdir(), "tack-install-"));
        install(home, "--prompt");
        install(home, "--prompt");
        assert.equal(readFileSync(join(home, ".zsh", "tack-prompt.zsh"), "utf-8"), ZSH_PROMPT);
        assert.equal(sourceLines(home).length, 1);
    });
    test("leaves a shell that never opted in alone", () => {
        const home = mkdtempSync(join(tmpdir(), "tack-install-"));
        install(home);
        assert.equal(existsSync(join(home, ".zsh", "tack-prompt.zsh")), false);
        assert.equal(sourceLines(home).length, 0);
    });
    test("refreshes an installed integration without the flag", () => {
        const home = mkdtempSync(join(tmpdir(), "tack-install-"));
        install(home, "--prompt");
        writeFileSync(join(home, ".zsh", "tack-prompt.zsh"), "# an older version\n");
        install(home);
        assert.equal(readFileSync(join(home, ".zsh", "tack-prompt.zsh"), "utf-8"), ZSH_PROMPT);
    });
});
