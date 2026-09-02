import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { announce, shouldAnnounce } from "./announce.js";
// The publishing half of interop: one self-contained line on tack's own stdout,
// which a sibling reads as a Bash call's `tool_response.stdout`. What it must
// never do is turn an operation that already landed into a command that failed,
// so every malformed call is a silent no-op rather than a throw.
describe("announce", () => {
    function capture(key, fields, env = {}) {
        const lines = [];
        const published = announce(key, fields, { env, out: (l) => lines.push(l) });
        return { lines, published };
    }
    it("prefixes the key with the plugin the announcement came from", () => {
        const { lines } = capture("session.started", { session: "abc", route: "r" });
        assert.equal(lines[0], 'codes.bridgeai.tack/session.started {"session":"abc","route":"r"}');
    });
    it("emits exactly one line", () => {
        const { lines } = capture("session.ended", { session: "abc", tacks: ["t1", "t2"] });
        assert.equal(lines.length, 1);
        assert.equal(lines[0].split("\n").length, 1);
    });
    it("keeps a value carrying a newline inside the string", () => {
        // The one-line contract is what a subscriber's line-anchored match depends
        // on, so a route slug or label with a newline in it must not break out.
        const { lines } = capture("session.ended", { route: "a\nb" });
        assert.equal(lines.length, 1);
        assert.match(lines[0], /"route":"a\\nb"/);
    });
    it("omits a field whose value is undefined rather than announcing null", () => {
        const { lines } = capture("session.started", { session: "abc", tack: undefined });
        assert.equal(lines[0], 'codes.bridgeai.tack/session.started {"session":"abc"}');
    });
    it("refuses a key outside the suite's grammar", () => {
        // The hyphen matters: anchor's publisher rejects one and beacon's reader
        // does not match it, so a `mode-changed` would publish into silence.
        for (const key of ["session.mode-changed", "Session.Started", "session", "session.a.b", ""]) {
            const { lines, published } = capture(key, { session: "abc" });
            assert.equal(published, false, key);
            assert.deepEqual(lines, [], key);
        }
    });
    it("says nothing, and does not throw, on a body it cannot encode", () => {
        const cyclic = {};
        cyclic.self = cyclic;
        const { lines, published } = capture("session.ended", cyclic);
        assert.equal(published, false);
        assert.deepEqual(lines, []);
    });
    it("stays silent when the caller says nobody can hear it", () => {
        const { lines, published } = capture("session.started", { session: "abc" }, { TACK_ANNOUNCE: "0" });
        assert.equal(published, false);
        assert.deepEqual(lines, []);
    });
});
describe("shouldAnnounce", () => {
    it("announces by default", () => {
        assert.equal(shouldAnnounce({}), true);
    });
    it("is off only for the exact opt-out value", () => {
        assert.equal(shouldAnnounce({ TACK_ANNOUNCE: "0" }), false);
        // Anything else is on: a subscriber going silent because a stray value read
        // as "off" is the failure this avoids.
        assert.equal(shouldAnnounce({ TACK_ANNOUNCE: "1" }), true);
        assert.equal(shouldAnnounce({ TACK_ANNOUNCE: "" }), true);
        assert.equal(shouldAnnounce({ TACK_ANNOUNCE: "false" }), true);
    });
});
