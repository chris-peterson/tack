import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, dirname, join } from "node:path";

// A supervised `tack serve`, so the documents are up whenever a link is
// clicked. Opt-in: bare `tack serve` in the foreground stays the default, and
// nothing here runs unless the user asks for it.

export const SERVICE_LABEL = "com.chris-peterson.tack.serve";

export type Supervisor = "launchd" | "systemd" | "none";

// The unit invokes the stable wrapper on PATH, never the plugin's versioned
// path — a plugin upgrade moves that path and would leave the unit pointing at
// a directory that no longer exists.
export function wrapperPath(): string {
  return join(homedir(), ".local", "bin", "tack");
}

// A supervisor starts the unit outside any shell, so it inherits none of the
// user's PATH: launchd sets no PATH at all (the agent gets
// /usr/bin:/bin:/usr/sbin:/sbin) and a systemd user unit gets a similarly bare
// one. Neither reaches wherever node lives — /opt/homebrew/bin, an nvm version
// dir — so the wrapper's `exec node` exits 127 and KeepAlive/Restart respawns
// it forever, which reads as "loaded, serving nothing". The unit carries the
// PATH from the shell that installed it, which by construction can reach node;
// re-run `tack serve install` after moving node to refresh the snapshot. The
// running node's own directory comes last, so an install invoked by absolute
// path works even with node on no PATH at all, while a shell PATH entry still
// wins — process.execPath resolves symlinks, so it names a version-specific
// directory (/opt/homebrew/Cellar/node/26.5.0/bin) that the next node upgrade
// removes, where the /opt/homebrew/bin the shell offers survives it.
export function servicePath(): string {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of [...(process.env.PATH ?? "").split(delimiter), dirname(process.execPath)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }
  return dirs.join(delimiter);
}

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

function unitPath(): string {
  return join(homedir(), ".config", "systemd", "user", "tack-serve.service");
}

export function supervisor(): Supervisor {
  if (platform() === "darwin") return "launchd";
  if (platform() === "linux" && probe("systemctl", ["--user", "--version"])) return "systemd";
  return "none";
}

function probe(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

// launchctl and systemctl failures are ordinary conditions here (nothing
// loaded, already loaded), so the caller reports them rather than throwing.
function run(cmd: string, args: string[]): { ok: boolean; err: string } {
  try {
    execFileSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 10_000 });
    return { ok: true, err: "" };
  } catch (e) {
    const err = e as { stderr?: Buffer; message: string };
    return { ok: false, err: (err.stderr?.toString() || err.message).trim() };
  }
}

// launchctl rejects a malformed plist outright, and PATH is the one value here
// the user could have put an `&` or a `<` into.
function xml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderPlist(
  wrapper: string,
  port: number,
  log: string,
  errLog: string,
  path: string,
): string {
  const args = [wrapper, "serve", "--port", String(port)]
    .map((a) => `        <string>${xml(a)}</string>`)
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
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xml(path)}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xml(log)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(errLog)}</string>
</dict>
</plist>
`;
}

export function renderUnit(wrapper: string, port: number, path: string): string {
  // systemd reads `%` as the start of a specifier, and splits an unquoted value
  // on whitespace.
  const env = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
  return `[Unit]
Description=tack route documents (serve)
After=default.target

[Service]
Environment="PATH=${env}"
ExecStart=${wrapper} serve --port ${port}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
}

function manualInstructions(port: number): void {
  console.log("No launchd or systemd here, so there is no unit to install.");
  console.log(`Run it yourself with:  tack serve --port ${port}`);
}

export function install(port: number): void {
  const wrapper = wrapperPath();
  if (!existsSync(wrapper)) {
    throw new Error(
      `${wrapper} does not exist — run \`tack install-cli\` first, so the unit ` +
        `points at a path that survives a plugin upgrade`,
    );
  }

  const sup = supervisor();
  if (sup === "none") return manualInstructions(port);

  if (sup === "launchd") {
    const logDir = join(homedir(), ".tack");
    mkdirSync(logDir, { recursive: true });
    mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(
      plistPath(),
      renderPlist(
        wrapper,
        port,
        join(logDir, "serve.log"),
        join(logDir, "serve.err.log"),
        servicePath(),
      ),
    );
    run("launchctl", ["unload", plistPath()]);
    const loaded = run("launchctl", ["load", plistPath()]);
    if (!loaded.ok) throw new Error(`launchctl load failed: ${loaded.err}`);
    console.log(`launchd agent loaded → http://127.0.0.1:${port}/`);
    return;
  }

  mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
  writeFileSync(unitPath(), renderUnit(wrapper, port, servicePath()));
  run("systemctl", ["--user", "daemon-reload"]);
  const enabled = run("systemctl", ["--user", "enable", "--now", "tack-serve.service"]);
  if (!enabled.ok) throw new Error(`systemctl enable failed: ${enabled.err}`);
  console.log(`systemd unit enabled → http://127.0.0.1:${port}/`);
}

export function uninstall(): void {
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

export function status(port: number): void {
  const sup = supervisor();
  if (sup === "none") {
    console.log("supervisor: none (no launchd or systemd)");
  } else {
    const path = sup === "launchd" ? plistPath() : unitPath();
    console.log(`supervisor: ${sup}`);
    console.log(`unit: ${existsSync(path) ? path : "not installed"}`);
    if (existsSync(path)) {
      const running =
        sup === "launchd"
          ? run("launchctl", ["list", SERVICE_LABEL]).ok
          : run("systemctl", ["--user", "is-active", "tack-serve.service"]).ok;
      console.log(`loaded: ${running ? "yes" : "no"}`);
    }
  }
  // Reachability is the question the user actually has — a loaded unit whose
  // process died answers "yes" above and still serves nothing.
  console.log(`url: http://127.0.0.1:${port}/`);
}
