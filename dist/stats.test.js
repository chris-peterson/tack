import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cachedProbe } from "./stats.js";
const stats = (state) => ({
    kind: "change_request", state, opened_at: "2026-10-15T19:07:04Z", additions: 1, deletions: 1, files: 1, commits: 1,
});
const stateOf = (s) => (s.kind === "commit" ? "commit" : s.state);
function counting(state) {
    const calls = [];
    const probe = async (url) => {
        calls.push(url);
        return stats(typeof state === "function" ? state() : state);
    };
    return { calls, probe };
}
describe("forge cache", () => {
    it("keeps a merged change request for good", async () => {
        let clock = 0;
        const { calls, probe } = counting("merged");
        const cached = cachedProbe(probe, 60_000, () => clock);
        await cached("u");
        clock = 10 * 60_000;
        await cached("u");
        assert.equal(calls.length, 1);
    });
    it("asks again about an open change request after the TTL", async () => {
        let clock = 0;
        let state = "draft";
        const { calls, probe } = counting(() => state);
        const cached = cachedProbe(probe, 60_000, () => clock);
        await cached("u");
        clock = 59_999;
        assert.equal(stateOf(await cached("u")), "draft");
        state = "merged";
        clock = 60_000;
        assert.equal(stateOf(await cached("u")), "merged");
        assert.equal(calls.length, 2);
    });
    it("keeps a commit for good", async () => {
        let clock = 0;
        let calls = 0;
        const cached = cachedProbe(async () => {
            calls++;
            return { kind: "commit", committed_at: "2026-10-16T00:53:36Z", additions: 35, deletions: 9, files: 2 };
        }, 60_000, () => clock);
        await cached("u");
        clock = 10 * 60_000;
        await cached("u");
        assert.equal(calls, 1);
    });
    it("shares one call between requests that arrive together", async () => {
        const { calls, probe } = counting("open");
        const cached = cachedProbe(probe);
        await Promise.all([cached("u"), cached("u"), cached("u")]);
        assert.equal(calls.length, 1);
    });
    it("does not keep a failure", async () => {
        let fail = true;
        let calls = 0;
        const cached = cachedProbe(async () => {
            calls++;
            if (fail)
                throw new Error("glab failed: 401");
            return stats("merged");
        });
        await assert.rejects(cached("u"), /401/);
        fail = false;
        assert.equal(stateOf(await cached("u")), "merged");
        assert.equal(calls, 2);
    });
});
