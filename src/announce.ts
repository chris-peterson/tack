// Publish one interop announcement on stdout, for a sibling plugin to react to.
//
//   announce("session.ended", { session: "abc", route: "auth-rewrite" })
//   -> codes.bridgeai.tack/session.ended {"session":"abc","route":"auth-rewrite"}
//
// The canonical guide is the suite's interop contract, which owns the grammar,
// the body rules, and the reasoning behind both:
// https://github.com/chris-peterson/claude-marketplace/blob/main/authoring/plugin-contract.md
//
// Every announcement tack makes comes through here, so the shape is checked in
// one place rather than at each call site. The plugin segment is fixed rather
// than a parameter: a plugin announces facts it caused, never one it observed a
// sibling cause.
//
// A subscriber reads these as a Bash tool call's `tool_response.stdout`, which
// is the whole reason they are lines on stdout rather than a side channel. It is
// also the limit: output nobody captures reaches nobody, which is what
// TACK_ANNOUNCE=0 exists to say (see shouldAnnounce).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PLUGIN = "tack";

// `<entity>.<event>`, lowercase alphanumeric. The grammar is the suite's, and
// it excludes the hyphen a name like `mode-changed` would want: anchor's
// publisher rejects one and beacon's reader does not match it, so a hyphenated
// key would be published into silence.
const KEY_PATTERN = /^[a-z0-9]+\.[a-z0-9]+$/;

// Whether announcements from this process can reach anyone.
//
// `hooks/session-nudge.sh` binds the session on every prompt and discards the
// CLI's output, so an announcement made there is written to /dev/null. It is a
// UserPromptSubmit hook besides, and that stdout becomes the agent's context
// rather than a tool response, so no PostToolUse subscriber sees it either. The
// hook sets TACK_ANNOUNCE=0 to say so, which leaves the announcement for the
// first binding the agent makes itself — the one a subscriber can actually read.
export function shouldAnnounce(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TACK_ANNOUNCE !== "0";
}

// Print the announcement, or return false having printed nothing.
//
// Never throws. This runs after the work it describes has landed, so turning an
// operation that succeeded into a command that failed is the one outcome it must
// not produce — the same rule the contract puts on every publisher.
export function announce(
  key: string,
  fields: Record<string, unknown>,
  opts: { env?: NodeJS.ProcessEnv; out?: (line: string) => void } = {},
): boolean {
  const env = opts.env ?? process.env;
  if (!shouldAnnounce(env)) return false;
  if (!KEY_PATTERN.test(key)) return false;

  let body: string;
  try {
    // JSON.stringify is what keeps the line self-contained: a value carrying a
    // newline is escaped inside the string rather than breaking the one-line
    // contract. A field whose value is undefined is dropped by it, which is how
    // an optional field is omitted rather than announced as null.
    body = JSON.stringify(fields);
  } catch {
    return false;
  }
  if (body === undefined) return false;

  (opts.out ?? console.log)(`codes.bridgeai.${PLUGIN}/${key} ${body}`);
  return true;
}

// Announce once per session id, whatever else happens in between.
//
// The debounce is on the *announcement*, not on the write that prompted it,
// because the two come apart: the prompt hook binds a session on every prompt
// with TACK_ANNOUNCE=0, so gating on "is this the first binding" would spend
// the session's start on the one bind nobody can hear and leave the agent's
// first visible bind silent. A marker written only when a line is actually
// emitted keeps the two in step.
//
// The marker is ephemeral by design — it answers "has this been said in this
// session", which stops mattering once the session is gone — so it lives beside
// the hooks' own debounce markers rather than in the route store, where the
// route schema governs and nothing about it is per-machine.
//
// A cleared TMPDIR mid-session means a second `session.started`. That is the
// contract's case, not a defect: every announcement is safe to repeat, and no
// ordering guarantee holds between subscribers.
export function announceOnce(
  key: string,
  sessionId: string,
  fields: Record<string, unknown>,
  opts: { env?: NodeJS.ProcessEnv; out?: (line: string) => void } = {},
): boolean {
  const env = opts.env ?? process.env;
  if (!shouldAnnounce(env)) return false;

  const dir = join(env.TMPDIR || tmpdir(), "tack-announce");
  // A session id reaches a path here, so it is held to the characters a path
  // segment may carry: an id with a slash or a `..` in it would otherwise
  // choose where the marker lands.
  const safeId = /^[A-Za-z0-9._-]+$/.test(sessionId) ? sessionId : null;
  const marker = safeId ? join(dir, `${key}.${safeId}`) : null;

  if (marker && existsSync(marker)) return false;

  const published = announce(key, fields, opts);

  if (published && marker) {
    // Best effort: an unwritable marker means a repeat announcement, which the
    // contract allows. Failing the command that just did the work does not.
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(marker, "");
    } catch {
      // nothing to do — the announcement already landed
    }
  }
  return published;
}
