import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
let sessions;
const tmp = mkdtempSync(join(tmpdir(), "tack-sessions-"));
process.env.TACK_HOME = tmp;
before(async () => {
    sessions = await import("./sessions.js");
});
after(() => {
    rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
    for (const d of readdirSync(tmp, { withFileTypes: true })) {
        if (d.isDirectory() && /^\d{4}$/.test(d.name)) {
            rmSync(join(tmp, d.name), { recursive: true, force: true });
        }
    }
});
const year = String(new Date().getFullYear());
const sessionFile = (id) => join(tmp, year, "sessions", `${id}.yaml`);
describe("the session store", () => {
    it("files a session under the year it started in, named by its id", () => {
        sessions.record("sess-a", "one", "t1");
        assert.ok(existsSync(sessionFile("sess-a")));
    });
    it("returns null for a session it has never seen", () => {
        assert.equal(sessions.load("sess-unknown"), null);
    });
    it("keeps started_at from the first touch", () => {
        const first = sessions.record("sess-a", "one", "t1").started_at;
        assert.equal(sessions.record("sess-a", "one", "t2").started_at, first);
    });
    it("holds refs across routes, in touch order", () => {
        sessions.record("sess-a", "one", "t1");
        sessions.record("sess-a", "two", "t3");
        assert.deepEqual(sessions.load("sess-a").tacks, ["one/t1", "two/t3"]);
    });
    it("refuses an id that would escape the store directory", () => {
        assert.throws(() => sessions.record("../../etc/passwd", "one", "t1"), /Invalid session id/);
        assert.throws(() => sessions.load("a/b"), /Invalid session id/);
    });
    it("refuses a file whose id disagrees with its filename", () => {
        sessions.record("sess-a", "one", "t1");
        renameSync(sessionFile("sess-a"), sessionFile("sess-renamed"));
        assert.throws(() => sessions.load("sess-renamed"), /declares id 'sess-a'/);
    });
    it("names that file and keeps listing the rest", () => {
        sessions.record("sess-a", "one", "t1");
        sessions.record("sess-b", "one", "t1");
        renameSync(sessionFile("sess-a"), sessionFile("sess-renamed"));
        const warnings = [];
        const write = process.stderr.write.bind(process.stderr);
        process.stderr.write = ((s) => {
            warnings.push(s);
            return true;
        });
        try {
            assert.deepEqual(sessions.all().map((s) => s.id), ["sess-b"]);
        }
        finally {
            process.stderr.write = write;
        }
        assert.match(warnings.join(""), /sess-renamed\.yaml/);
    });
    it("lists every session it holds", () => {
        sessions.record("sess-a", "one", "t1");
        sessions.record("sess-b", "one", "t1");
        assert.deepEqual(sessions.all().map((s) => s.id).sort(), ["sess-a", "sess-b"]);
    });
    // A conversation that opens a route, reads around and exits is the common
    // case, and a file per glance is a store of records saying nothing happened.
    describe("a session earns a file by producing a tack", () => {
        it("writes nothing for a touch by a session with no record", () => {
            assert.equal(sessions.record("sess-a", "one"), null);
            assert.ok(!existsSync(sessionFile("sess-a")));
        });
        it("records the touch once the session has a file", () => {
            sessions.record("sess-a", "one", "t1");
            sessions.record("sess-a", "two");
            assert.deepEqual(sessions.load("sess-a").routes, ["one", "two"]);
        });
        it("has nothing to end for a session that produced nothing", () => {
            sessions.record("sess-a", "one");
            assert.equal(sessions.end("sess-a"), null);
            assert.ok(!existsSync(sessionFile("sess-a")));
        });
    });
    describe("the touch list", () => {
        it("stays a superset of the slugs in tacks", () => {
            sessions.record("sess-a", "one", "t1");
            sessions.record("sess-a", "two");
            const s = sessions.load("sess-a");
            assert.deepEqual(s.routes, ["one", "two"]);
            assert.deepEqual(s.tacks, ["one/t1"]);
        });
        it("does not duplicate a route touched again", () => {
            sessions.record("sess-a", "one", "t1");
            sessions.record("sess-a", "one");
            assert.deepEqual(sessions.load("sess-a").routes, ["one"]);
        });
    });
    describe("ending", () => {
        it("stamps ended_at", () => {
            sessions.record("sess-a", "one", "t1");
            assert.ok(sessions.end("sess-a").ended_at);
        });
        it("reports null and writes nothing for an unknown session", () => {
            assert.equal(sessions.end("sess-ghost"), null);
            assert.ok(!existsSync(sessionFile("sess-ghost")));
        });
        it("clears the stamp when the session touches tack again", () => {
            sessions.record("sess-a", "one", "t1");
            sessions.end("sess-a");
            assert.equal(sessions.record("sess-a", "one").ended_at, undefined);
        });
    });
    describe("onRoute", () => {
        it("finds the sessions that touched a route", () => {
            sessions.record("sess-here", "one", "t1");
            sessions.record("sess-visited", "two", "t1");
            sessions.record("sess-visited", "one");
            sessions.record("sess-other", "three", "t1");
            assert.deepEqual(sessions.onRoute("one").map((s) => s.id).sort(), ["sess-here", "sess-visited"]);
        });
        it("is empty for a route nothing touched", () => {
            sessions.record("sess-a", "one", "t1");
            assert.deepEqual(sessions.onRoute("three"), []);
        });
    });
    describe("tacksOn", () => {
        it("narrows cross-route refs to one route's bare ids", () => {
            sessions.record("sess-a", "one", "t1");
            sessions.record("sess-a", "two", "t3");
            assert.deepEqual(sessions.tacksOn("sess-a", "one"), ["t1"]);
            assert.deepEqual(sessions.tacksOn("sess-a", "two"), ["t3"]);
        });
        it("is empty for a route the session never touched", () => {
            sessions.record("sess-a", "one", "t1");
            assert.deepEqual(sessions.tacksOn("sess-a", "three"), []);
        });
        // `one` is not a prefix of `one-more` as a path segment, though it is as a
        // string — the separator is what the filter has to respect.
        it("does not match a route whose slug merely starts the same", () => {
            sessions.record("sess-a", "one-more", "t1");
            assert.deepEqual(sessions.tacksOn("sess-a", "one"), []);
        });
    });
    describe("remapRefs", () => {
        it("rewrites a ref and reports the session it touched", () => {
            sessions.record("sess-a", "one", "t1");
            const touched = sessions.remapRefs(new Map([["one/t1", "two/t5"]]));
            assert.deepEqual(touched, ["sess-a"]);
            assert.deepEqual(sessions.load("sess-a").tacks, ["two/t5"]);
        });
        it("carries the touch list to the route a moved tack landed on", () => {
            sessions.record("sess-a", "one", "t1");
            sessions.remapRefs(new Map([["one/t1", "two/t5"]]));
            // `one` stays: the session did work there, and moving the tack out
            // doesn't unmake that.
            assert.deepEqual(sessions.load("sess-a").routes, ["one", "two"]);
        });
        it("renames a route across both the refs and the touch list", () => {
            sessions.record("sess-a", "old", "t1");
            sessions.remapRefs(new Map([["old/t1", "new/t1"]]), new Map([["old", "new"]]));
            const s = sessions.load("sess-a");
            assert.deepEqual(s.routes, ["new"]);
            assert.deepEqual(s.tacks, ["new/t1"]);
        });
        it("drops a slug mapped to null, as a merged-away source", () => {
            sessions.record("sess-a", "kept", "t1");
            sessions.record("sess-a", "gone");
            sessions.remapRefs(new Map(), new Map([["gone", null]]));
            assert.deepEqual(sessions.load("sess-a").routes, ["kept"]);
        });
        it("drops a ref mapped to null, and the field with the last of them", () => {
            sessions.record("sess-a", "one", "t1");
            sessions.remapRefs(new Map([["one/t1", null]]));
            assert.equal(sessions.load("sess-a").tacks, undefined);
        });
        it("collapses two refs mapped onto one, keeping the later touch", () => {
            sessions.record("sess-a", "one", "t1");
            sessions.record("sess-a", "one", "t2");
            sessions.remapRefs(new Map([["one/t1", "one/t9"], ["one/t2", "one/t9"]]));
            assert.deepEqual(sessions.load("sess-a").tacks, ["one/t9"]);
        });
        it("leaves a session with no matching ref untouched", () => {
            sessions.record("sess-a", "one", "t1");
            assert.deepEqual(sessions.remapRefs(new Map([["other/t1", "two/t1"]])), []);
        });
    });
});
