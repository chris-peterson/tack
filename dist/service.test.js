import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderPlist, renderUnit, supervisor, wrapperPath, SERVICE_LABEL } from "./service.js";
describe("service units", () => {
    // The unit outlives plugin upgrades only if it invokes the stable wrapper on
    // PATH; a versioned plugin path stops existing on the next install.
    it("invoke the wrapper on PATH, not a versioned plugin path", () => {
        const wrapper = wrapperPath();
        assert.match(wrapper, /\.local\/bin\/tack$/);
        assert.ok(renderPlist(wrapper, 8788, "/tmp/o.log", "/tmp/e.log").includes(wrapper));
        assert.ok(renderUnit(wrapper, 8788).includes(wrapper));
    });
    it("carry the port they were installed with", () => {
        assert.match(renderPlist(wrapperPath(), 9001, "/tmp/o", "/tmp/e"), /<string>9001<\/string>/);
        assert.match(renderUnit(wrapperPath(), 9001), /--port 9001/);
    });
    it("restart on their own so a reboot leaves the documents reachable", () => {
        assert.match(renderPlist(wrapperPath(), 8788, "/tmp/o", "/tmp/e"), /<key>KeepAlive<\/key>/);
        assert.match(renderUnit(wrapperPath(), 8788), /Restart=always/);
    });
    it("label the launchd agent distinctly enough to find in launchctl list", () => {
        assert.match(SERVICE_LABEL, /^com\.chris-peterson\.tack\./);
    });
    it("name a supervisor this platform actually has", () => {
        assert.ok(["launchd", "systemd", "none"].includes(supervisor()));
    });
});
