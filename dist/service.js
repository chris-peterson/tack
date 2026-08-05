import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
// A supervised `tack serve`, so the documents are up whenever a link is
// clicked. Opt-in: bare `tack serve` in the foreground stays the default, and
// nothing here runs unless the user asks for it.
export const SERVICE_LABEL = "com.chris-peterson.tack.serve";
// The unit invokes the stable wrapper on PATH, never the plugin's versioned
// path — a plugin upgrade moves that path and would leave the unit pointing at
// a directory that no longer exists.
export function wrapperPath() {
    return join(homedir(), ".local", "bin", "tack");
}
function plistPath() {
    return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}
function unitPath() {
    return join(homedir(), ".config", "systemd", "user", "tack-serve.service");
}
export function supervisor() {
    if (platform() === "darwin")
        return "launchd";
    if (platform() === "linux" && probe("systemctl", ["--user", "--version"]))
        return "systemd";
    return "none";
}
function probe(cmd, args) {
    try {
        execFileSync(cmd, args, { stdio: "ignore", timeout: 10_000 });
        return true;
    }
    catch {
        return false;
    }
}
// launchctl and systemctl failures are ordinary conditions here (nothing
// loaded, already loaded), so the caller reports them rather than throwing.
function run(cmd, args) {
    try {
        execFileSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 10_000 });
        return { ok: true, err: "" };
    }
    catch (e) {
        const err = e;
        return { ok: false, err: (err.stderr?.toString() || err.message).trim() };
    }
}
export function renderPlist(wrapper, port, log, errLog) {
    const args = [wrapper, "serve", "--port", String(port)]
        .map((a) => `        <string>${a}</string>`)
        .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${log}</string>
    <key>StandardErrorPath</key>
    <string>${errLog}</string>
</dict>
</plist>
`;
}
export function renderUnit(wrapper, port) {
    return `[Unit]
Description=tack route documents (serve)
After=default.target

[Service]
ExecStart=${wrapper} serve --port ${port}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
}
function manualInstructions(port) {
    console.log("No launchd or systemd here, so there is no unit to install.");
    console.log(`Run it yourself with:  tack serve --port ${port}`);
}
export function install(port) {
    const wrapper = wrapperPath();
    if (!existsSync(wrapper)) {
        throw new Error(`${wrapper} does not exist — run \`tack install-cli\` first, so the unit ` +
            `points at a path that survives a plugin upgrade`);
    }
    const sup = supervisor();
    if (sup === "none")
        return manualInstructions(port);
    if (sup === "launchd") {
        const logDir = join(homedir(), ".tack");
        mkdirSync(logDir, { recursive: true });
        mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
        writeFileSync(plistPath(), renderPlist(wrapper, port, join(logDir, "serve.log"), join(logDir, "serve.err.log")));
        run("launchctl", ["unload", plistPath()]);
        const loaded = run("launchctl", ["load", plistPath()]);
        if (!loaded.ok)
            throw new Error(`launchctl load failed: ${loaded.err}`);
        console.log(`launchd agent loaded → http://127.0.0.1:${port}/`);
        return;
    }
    mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
    writeFileSync(unitPath(), renderUnit(wrapper, port));
    run("systemctl", ["--user", "daemon-reload"]);
    const enabled = run("systemctl", ["--user", "enable", "--now", "tack-serve.service"]);
    if (!enabled.ok)
        throw new Error(`systemctl enable failed: ${enabled.err}`);
    console.log(`systemd unit enabled → http://127.0.0.1:${port}/`);
}
export function uninstall() {
    const sup = supervisor();
    if (sup === "none") {
        console.log("No launchd or systemd here — nothing was installed.");
        return;
    }
    if (sup === "launchd") {
        if (!existsSync(plistPath())) {
            console.log("Not installed.");
            return;
        }
        run("launchctl", ["unload", plistPath()]);
        unlinkSync(plistPath());
        console.log("launchd agent removed.");
        return;
    }
    if (!existsSync(unitPath())) {
        console.log("Not installed.");
        return;
    }
    run("systemctl", ["--user", "disable", "--now", "tack-serve.service"]);
    unlinkSync(unitPath());
    run("systemctl", ["--user", "daemon-reload"]);
    console.log("systemd unit removed.");
}
export function status(port) {
    const sup = supervisor();
    if (sup === "none") {
        console.log("supervisor: none (no launchd or systemd)");
    }
    else {
        const path = sup === "launchd" ? plistPath() : unitPath();
        console.log(`supervisor: ${sup}`);
        console.log(`unit: ${existsSync(path) ? path : "not installed"}`);
        if (existsSync(path)) {
            const running = sup === "launchd"
                ? run("launchctl", ["list", SERVICE_LABEL]).ok
                : run("systemctl", ["--user", "is-active", "tack-serve.service"]).ok;
            console.log(`loaded: ${running ? "yes" : "no"}`);
        }
    }
    // Reachability is the question the user actually has — a loaded unit whose
    // process died answers "yes" above and still serves nothing.
    console.log(`url: http://127.0.0.1:${port}/`);
}
