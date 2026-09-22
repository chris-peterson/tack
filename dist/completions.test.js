import { test, describe } from "node:test";
import assert from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ZSH_COMPLETION } from "./completions.js";
// The completion script reads the store directly rather than shelling out to
// `tack` on every keystroke, which means it carries its own copy of the layout
// — the one thing in the repo that can disagree with `route.ts` about where a
// route file lives. It did: the helpers read `<root>/routes` for a store that
// has been `<root>/<year>/routes` since routes were filed by year, so every
// slug, tack id, and link url silently completed to nothing.
describe("the completion script's view of the store", () => {
    test("globs route files across years rather than reading one directory", () => {
        assert.match(ZSH_COMPLETION, /\/\*\/routes\/\*\.yaml/);
        assert.doesNotMatch(ZSH_COMPLETION, /\.tack\}\/routes/);
    });
});
const zsh = spawnSync("zsh", ["-f", "-c", "exit 0"]).status === 0;
// Driving the helpers needs zsh itself: they are zsh functions using zsh glob
// qualifiers. Where it is absent the structural test above still holds the
// layout, and this block says it was skipped rather than passing quietly.
describe("the completion helpers against a year-partitioned store", { skip: !zsh }, () => {
    const home = mkdtempSync(join(tmpdir(), "tack-completions-"));
    mkdirSync(join(home, "2024", "routes"), { recursive: true });
    writeFileSync(join(home, "2024", "routes", "old-year.yaml"), [
        "id: 11111111-1111-4111-8111-111111111111",
        "slug: old-year",
        "created_at: 2024-02-01T00:00:00.000Z",
        "updated_at: 2024-02-01T00:00:00.000Z",
        "tacks:",
        "  - id: t1",
        "    summary: A tack from an earlier year",
        "    status: pending",
        "    links:",
        "      - label: doc",
        "        url: https://example.com/doc",
        "",
    ].join("\n"));
    const script = join(home, "_tack");
    writeFileSync(script, ZSH_COMPLETION);
    // compadd and _describe only exist inside a completion context, so the probe
    // stands in for them and prints what the helper offered.
    const harness = join(home, "probe.zsh");
    writeFileSync(harness, [
        "compadd() {",
        "  local -a vals",
        "  while (( $# )); do",
        "    case $1 in",
        "      -a|-d|-S|-X) shift; [[ $1 == -* ]] && continue; vals+=( \"${(P)1[@]}\" ) ;;",
        "      -l|-q|-Q) ;;",
        "      *) vals+=( \"$1\" ) ;;",
        "    esac",
        "    shift",
        "  done",
        '  print -l -- "${vals[@]}"',
        "}",
        "_describe() { shift; print -l -- \"${(P)1[@]}\" }",
        "_message() { : }",
        "_arguments() { : }",
        `source ${script} 2>/dev/null`,
        '"$@"',
        "",
    ].join("\n"));
    const run = (fn, ...args) => 
    // `-f`: the user's own ~/.zshenv runs even for a non-interactive script, and
    // one that exports TACK_HOME would point the helpers at a real store.
    execFileSync("zsh", ["-f", harness, fn, ...args], {
        encoding: "utf-8",
        env: { ...process.env, TACK_HOME: home },
    }).trim();
    test("offers a route filed under an earlier year", () => {
        assert.match(run("_tack_routes"), /old-year/);
    });
    test("resolves a slug to the file in the year it was opened in", () => {
        assert.strictEqual(run("_tack_route_file", "old-year"), join(home, "2024", "routes", "old-year.yaml"));
    });
    test("offers a tack id with its summary as the description", () => {
        assert.match(run("_tack_tack_ids", "old-year"), /t1:A tack from an earlier year/);
    });
    test("offers a link url, which sits two levels in as a list item's key", () => {
        assert.match(run("_tack_link_urls", "old-year", "t1"), /https:\/\/example\.com\/doc/);
    });
});
