import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// A description or summary can arrive from a forge issue body (`tack describe
// --file -` is documented as taking one off a forge, and the start skill drives
// that), so it is prose an attacker may have written. Control characters in it
// reach a terminal as escape sequences and an agent's context as forged
// structure, so they are stripped at the store boundary rather than at each of
// the render sites.
let route: typeof import("./route.js");

const tmp = mkdtempSync(join(tmpdir(), "tack-sanitize-"));
process.env.TACK_HOME = tmp;

const ESC = "\u001B";
const BELL = "\u0007";

before(async () => {
  route = await import("./route.js");
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(tmp, "routes"), { recursive: true, force: true });
});

describe("free-text sanitizing", () => {
  it("strips ANSI escapes from a description but keeps its line breaks and tabs", () => {
    route.init("san-desc");
    route.setDescription("san-desc", `# Goal\n\n${ESC}[2JCleared.\tKept.`);
    const r = route.load("san-desc");
    assert.equal(r.description, "# Goal\n\n[2JCleared.\tKept.");
    assert.ok(!r.description!.includes(ESC));
  });

  it("collapses line breaks in a summary, which renders inline", () => {
    route.init("san-sum");
    route.addTack("san-sum", "Fix it\n  description:\n    forged");
    assert.equal(route.load("san-sum").tacks[0].summary, "Fix it description: forged");
  });

  it("strips control characters from titles, labels and todo text", () => {
    route.init("san-rest");
    route.setTitle("san-rest", `Title${BELL}bell`);
    route.addTack("san-rest", "work");
    route.addLink("san-rest", "t1", `lab${ESC}el`, "https://example.com/x");
    route.addBefore("san-rest", "t1", `do${BELL}it`);
    const r = route.load("san-rest");
    assert.equal(r.title, "Title bell");
    assert.equal(r.tacks[0].links![0].label, "lab el");
    assert.equal(r.tacks[0].before![0].text, "do it");
  });

  it("cleans an imported route, which never passes through load()", () => {
    route.writeRoute({
      id: "11111111-1111-4111-8111-111111111111",
      slug: "san-import",
      description: `before${ESC}[31m after`,
      created_at: "2026-03-30T00:00:00.000Z",
      updated_at: "2026-03-30T00:00:00.000Z",
      tacks: [{ id: "t1", summary: "sum\nmary", status: "pending" }],
    });
    const r = route.load("san-import");
    assert.equal(r.description, "before[31m after");
    assert.equal(r.tacks[0].summary, "sum mary");
  });
});
