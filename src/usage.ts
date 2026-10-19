// What a session spent, read from its Claude Code transcript. The session store
// ([SESS-01]) holds only ids and times; the transcript is where the turns and
// token counts are, so this reads it on demand and writes nothing back. It is
// the one module that knows the transcript format: a session from another tool
// has no transcript here and reads as `null`, the same as one Claude Code has
// already aged out.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

// A gap between transcript records longer than this is time away, not work.
export const IDLE_GAP_S = 300;

export interface Tokens {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface SessionUsage {
  id: string;
  /** Basename of the directory the session ran in. */
  cwd?: string;
  first: string;
  last: string;
  /** Sum of the gaps between records that are at most IDLE_GAP_S long. */
  active_s: number;
  /** Prompts the user typed, slash commands included. */
  prompts: number;
  /** API responses, sub-agents included. */
  requests: number;
  tokens: Tokens;
  subagents: number;
}

function projectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

export function transcriptPath(id: string): string | null {
  const root = projectsDir();
  if (!existsSync(root)) return null;
  for (const d of readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = join(root, d.name, `${id}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

function subagentTranscripts(main: string, id: string): string[] {
  const dir = join(main, "..", id, "subagents");
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f));
}

interface Rec {
  type?: string;
  timestamp?: string;
  cwd?: string;
  requestId?: string;
  origin?: { kind?: string };
  message?: {
    id?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

function* records(path: string): Generator<Rec> {
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (line) yield JSON.parse(line) as Rec;
  }
}

export function sessionUsage(id: string): SessionUsage | null {
  const main = transcriptPath(id);
  if (!main) return null;

  const tokens: Tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  // Claude Code writes one line per content block and repeats the response's
  // usage on each, so summing lines counts a response several times.
  const seen = new Set<string>();
  let requests = 0;
  const count = (r: Rec): void => {
    const u = r.message?.usage;
    if (r.type !== "assistant" || !u) return;
    const key = r.message?.id ?? r.requestId;
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    requests++;
    tokens.input += u.input_tokens ?? 0;
    tokens.output += u.output_tokens ?? 0;
    tokens.cache_read += u.cache_read_input_tokens ?? 0;
    tokens.cache_write += u.cache_creation_input_tokens ?? 0;
  };

  const stamps: number[] = [];
  let prompts = 0;
  let cwd: string | undefined;
  for (const r of records(main)) {
    if (r.timestamp) stamps.push(Date.parse(r.timestamp));
    if (!cwd && r.cwd) cwd = basename(r.cwd);
    if (r.type === "user" && r.origin?.kind === "human") prompts++;
    count(r);
  }
  const subs = subagentTranscripts(main, id);
  for (const s of subs) for (const r of records(s)) count(r);

  if (!stamps.length) return null;
  stamps.sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < stamps.length; i++) {
    const gap = (stamps[i] - stamps[i - 1]) / 1000;
    if (gap <= IDLE_GAP_S) active += gap;
  }

  return {
    id,
    ...(cwd ? { cwd } : {}),
    first: new Date(stamps[0]).toISOString(),
    last: new Date(stamps[stamps.length - 1]).toISOString(),
    active_s: Math.round(active),
    prompts,
    requests,
    tokens,
    subagents: subs.length,
  };
}

export function totalTokens(t: Tokens): number {
  return t.input + t.output + t.cache_read + t.cache_write;
}
