import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderPlist,
  renderUnit,
  servicePath,
  supervisor,
  wrapperPath,
  SERVICE_LABEL,
} from "./service.js";
import { delimiter, dirname } from "node:path";

const PATH = "/opt/homebrew/bin:/usr/bin:/bin";

describe("service units", () => {
  // The unit outlives plugin upgrades only if it invokes the stable wrapper on
  // PATH; a versioned plugin path stops existing on the next install.
  it("invoke the wrapper on PATH, not a versioned plugin path", () => {
    const wrapper = wrapperPath();
    assert.match(wrapper, /\.local\/bin\/tack$/);
    assert.ok(renderPlist(wrapper, 8788, "/tmp/o.log", "/tmp/e.log", PATH).includes(wrapper));
    assert.ok(renderUnit(wrapper, 8788, PATH).includes(wrapper));
  });

  it("carry the port they were installed with", () => {
    assert.match(
      renderPlist(wrapperPath(), 9001, "/tmp/o", "/tmp/e", PATH),
      /<string>9001<\/string>/,
    );
    assert.match(renderUnit(wrapperPath(), 9001, PATH), /--port 9001/);
  });

  it("restart on their own so a reboot leaves the documents reachable", () => {
    assert.match(
      renderPlist(wrapperPath(), 8788, "/tmp/o", "/tmp/e", PATH),
      /<key>KeepAlive<\/key>/,
    );
    assert.match(renderUnit(wrapperPath(), 8788, PATH), /Restart=always/);
  });

  // A supervisor starts the unit with a bare PATH that cannot reach node, so a
  // unit that doesn't carry one exits 127 and respawns forever.
  it("carry a PATH that reaches node", () => {
    assert.match(
      renderPlist(wrapperPath(), 8788, "/tmp/o", "/tmp/e", PATH),
      /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin:\/bin<\/string>/,
    );
    assert.match(renderUnit(wrapperPath(), 8788, PATH), /^Environment="PATH=\/opt\/homebrew/m);
  });

  // A supervisor starts the server without a login shell, so a TACK_HOME set in
  // a shell profile never reaches it — and the fallback is `~/.tack`, which on a
  // machine whose store is elsewhere serves an empty index rather than failing.
  it("carry the store the install was run against", () => {
    const home = "/Users/x/src/tack.db";
    assert.match(
      renderPlist(wrapperPath(), 8788, "/tmp/o", "/tmp/e", PATH, home),
      /<key>TACK_HOME<\/key>\s*<string>\/Users\/x\/src\/tack\.db<\/string>/,
    );
    assert.match(
      renderUnit(wrapperPath(), 8788, PATH, home),
      /^Environment="TACK_HOME=\/Users\/x\/src\/tack\.db"$/m,
    );
  });

  // The default store needs no variable, and writing one would pin a unit to a
  // path the user never chose.
  it("leave TACK_HOME out when the store is the default", () => {
    assert.doesNotMatch(
      renderPlist(wrapperPath(), 8788, "/tmp/o", "/tmp/e", PATH),
      /TACK_HOME/,
    );
    assert.doesNotMatch(renderUnit(wrapperPath(), 8788, PATH), /TACK_HOME/);
  });

  it("escape a store path the unit format would otherwise choke on", () => {
    assert.match(
      renderPlist(wrapperPath(), 8788, "/tmp/o", "/tmp/e", PATH, "/a&b"),
      /<string>\/a&amp;b<\/string>/,
    );
    assert.match(renderUnit(wrapperPath(), 8788, PATH, "/100%/tack"), /TACK_HOME=\/100%%\/tack/);
  });

  it("include the running node's own directory, so the lookup can't come up empty", () => {
    const dirs = servicePath().split(delimiter);
    assert.ok(dirs.includes(dirname(process.execPath)));
    assert.equal(new Set(dirs).size, dirs.length, "no duplicate entries");
  });

  // process.execPath resolves symlinks, so it names a version-specific node
  // directory that the next upgrade removes; the shell's own entry outlives it.
  it("prefer the shell's PATH entries over the resolved node directory", () => {
    const dirs = servicePath().split(delimiter);
    const shellFirst = (process.env.PATH ?? "").split(delimiter).filter(Boolean)[0];
    if (shellFirst && shellFirst !== dirname(process.execPath)) {
      assert.ok(dirs.indexOf(shellFirst) < dirs.indexOf(dirname(process.execPath)));
    }
  });

  // launchctl refuses a malformed plist, and systemd reads `%` as a specifier
  // and splits an unquoted value on whitespace.
  it("escape a PATH the unit format would otherwise choke on", () => {
    assert.match(renderPlist(wrapperPath(), 8788, "/tmp/o", "/tmp/e", "/a&b:/c<d"), /\/a&amp;b/);
    assert.ok(!renderPlist(wrapperPath(), 8788, "/tmp/o", "/tmp/e", "/c<d").includes("/c<d"));
    assert.match(renderUnit(wrapperPath(), 8788, "/a b:/100%/bin"), /"PATH=\/a b:\/100%%\/bin"/);
  });

  it("label the launchd agent distinctly enough to find in launchctl list", () => {
    assert.match(SERVICE_LABEL, /^com\.chris-peterson\.tack\./);
  });

  it("name a supervisor this platform actually has", () => {
    assert.ok(["launchd", "systemd", "none"].includes(supervisor()));
  });
});
