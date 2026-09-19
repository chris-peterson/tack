import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeVersion, isDevBuild } from "./build-info.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("build-info", () => {
  it("reads this checkout as a dev build", () => {
    assert.equal(isDevBuild(), true);
  });

  it("marks the version with the commit it was built from", () => {
    const sha = execFileSync("git", ["-C", here, "rev-parse", "--short=7", "HEAD"], {
      encoding: "utf-8",
    }).trim();
    assert.match(describeVersion("9.9.9"), new RegExp(`^9\\.9\\.9-dev\\.g${sha}(\\.dirty)?$`));
  });

  // The published copy is the case a checkout can never be, and the one the
  // marker exists to stay out of the way of — so it is exercised rather than
  // asserted from the shape of the code.
  it("leaves the version alone where the package root carries no .git", async () => {
    const root = mkdtempSync(join(tmpdir(), "tack-build-info-"));
    mkdirSync(join(root, "dist"));
    copyFileSync(join(here, "build-info.js"), join(root, "dist", "build-info.js"));
    const mod = await import(join(root, "dist", "build-info.js"));
    assert.equal(mod.isDevBuild(), false);
    assert.equal(mod.describeVersion("9.9.9"), "9.9.9");
  });
});
