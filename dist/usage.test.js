import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sessionUsage, totalTokens } from "./usage.js";
const config = mkdtempSync(join(tmpdir(), "tack-usage-test-"));
process.env.CLAUDE_CONFIG_DIR = config;
after(() => {
    rmSync(config, { recursive: true, force: true });
});
const T0 = Date.parse("2026-10-15T18:00:00Z");
const at = (s) => new Date(T0 + s * 1000).toISOString();
const usage = (input, output, read, write) => ({
    input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write,
});
function transcript(dir, name, recs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
describe("session usage from a transcript", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    const project = join(config, "projects", "-Users-me-src-acme-widget");
    transcript(project, `${id}.jsonl`, [
        { type: "user", timestamp: at(0), cwd: "/Users/me/src/acme-widget", origin: { kind: "human" }, message: { content: "do the thing" } },
        // One response written as two content-block lines, each repeating its usage.
        { type: "assistant", timestamp: at(10), requestId: "r1", message: { id: "m1", usage: usage(2, 100, 1000, 50) } },
        { type: "assistant", timestamp: at(10), requestId: "r1", message: { id: "m1", usage: usage(2, 100, 1000, 50) } },
        { type: "user", timestamp: at(20), message: { content: [{ type: "tool_result" }] } },
        { type: "user", timestamp: at(30), origin: { kind: "task-notification" }, message: { content: "<task-notification>" } },
        { type: "assistant", timestamp: at(40), requestId: "r2", message: { id: "m2", usage: usage(1, 10, 2000, 0) } },
        // Ten minutes away from the keyboard.
        { type: "assistant", timestamp: at(640), requestId: "r3", message: { id: "m3", usage: usage(1, 5, 3000, 0) } },
        { type: "user", timestamp: at(700), origin: { kind: "human" }, message: { content: "/anchor:commit" } },
    ]);
    transcript(join(project, id, "subagents"), "agent-a.jsonl", [
        { type: "assistant", timestamp: at(5000), requestId: "s1", message: { id: "sm1", usage: usage(0, 7, 400, 30) } },
    ]);
    const u = sessionUsage(id);
    it("counts each API response once, sub-agents included", () => {
        assert.equal(u.requests, 4);
        assert.deepEqual(u.tokens, { input: 4, output: 122, cache_read: 6400, cache_write: 80 });
        assert.equal(totalTokens(u.tokens), 6606);
        assert.equal(u.subagents, 1);
    });
    it("counts only the prompts a person typed", () => {
        assert.equal(u.prompts, 2);
    });
    it("leaves gaps longer than five minutes out of active time", () => {
        assert.equal(u.active_s, 100);
        assert.equal(u.first, at(0));
        assert.equal(u.last, at(700));
    });
    it("names the directory the session ran in", () => {
        assert.equal(u.cwd, "acme-widget");
    });
    it("is null for a session with no transcript on this machine", () => {
        assert.equal(sessionUsage("99999999-0000-0000-0000-000000000000"), null);
    });
});
