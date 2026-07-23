// The repo database (REPO category): a standalone index mapping the names a git
// repository is known by to its remote, accumulated as tack observes work.
// Internal derived state like pins — tack is its sole writer, so it carries no
// published JSON Schema (REPO-05). Stored as a bare map keyed by normalized
// remote at ~/.tack/repos.yaml (REPO-01).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { parse, stringify } from "yaml";

const TACK_HOME = process.env.TACK_HOME ?? join(homedir(), ".tack");
const REPOS_FILE = join(TACK_HOME, "repos.yaml");

export interface RepoEntry {
  // Names the repo is known by: the auto-derived name plus custom aliases.
  names: string[];
  // Absolute paths of known local checkouts/worktrees.
  locals?: string[];
}

// Keyed by normalized remote (host/path), e.g. github.com/chris-peterson/anchor.
export type RepoDb = Record<string, RepoEntry>;

export interface RepoMatch {
  key: string;
  url: string;
  names: string[];
  locals: string[]; // only locals that still exist on disk
}

// --- Normalization (REPO-02) ---

// Normalize a git remote (HTTPS or SSH) to scheme-less host/path form, dropping
// a trailing .git, so the HTTPS and SSH forms of one remote collapse to a
// single key. Returns null when the input doesn't look like a remote.
export function normalizeGitRemote(remote: string): string | null {
  let s = remote.trim();
  if (!s) return null;

  // scp-like SSH: git@host:org/repo(.git)
  const scp = s.match(/^[^@/]+@([^:/]+):(.+)$/);
  if (scp) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // strip scheme://
    s = s.replace(/^[^@/]+@/, ""); // strip userinfo@ (ssh://git@host/…)
  }

  s = s.replace(/\.git$/, "").replace(/\/+$/, "");
  return s.includes("/") ? s : null;
}

// Extract the repo key from a forge change-reference URL (PR/MR/issue/commit).
// Mirrors the forges recognized in CLI-37; returns null for anything that isn't
// a recognized change reference, so plain links (docs, etc.) are not captured.
export function repoKeyFromForgeUrl(url: string): string | null {
  const gh = url.match(
    /^https:\/\/(github\.com)\/([^/]+)\/([^/]+)\/(?:pull|issues|commit)\//i,
  );
  if (gh) return `${gh[1]}/${gh[2]}/${gh[3].replace(/\.git$/, "")}`;

  const gl = url.match(
    /^https:\/\/(gitlab\.[^/]+)\/(.+?)\/-\/(?:merge_requests|issues|commit)\//i,
  );
  if (gl) return `${gl[1]}/${gl[2].replace(/\.git$/, "")}`;

  return null;
}

export function repoNameFromKey(key: string): string {
  const segs = key.split("/");
  return segs[segs.length - 1];
}

export function httpsUrl(key: string): string {
  return `https://${key}`;
}

// --- Storage (REPO-01, REPO-04, REPO-05) ---

function ensureHome(): void {
  if (!existsSync(TACK_HOME)) mkdirSync(TACK_HOME, { recursive: true });
}

export function loadRepos(): RepoDb {
  if (!existsSync(REPOS_FILE)) return {};
  return (parse(readFileSync(REPOS_FILE, "utf-8")) ?? {}) as RepoDb;
}

function saveRepos(db: RepoDb): void {
  ensureHome();
  writeFileSync(REPOS_FILE, stringify(db), "utf-8");
}

// Overwrite the repo database wholesale — used by backup restore/merge, which
// computes the merged db and hands it back to persist in one write.
export function saveReplace(db: RepoDb): void {
  saveRepos(db);
}

function upsert(db: RepoDb, key: string, opts: { name?: string; local?: string }): void {
  const entry = db[key] ?? { names: [] };
  if (opts.name && !entry.names.includes(opts.name)) entry.names.push(opts.name);
  if (opts.local) {
    if (!entry.locals) entry.locals = [];
    if (!entry.locals.includes(opts.local)) entry.locals.push(opts.local);
  }
  db[key] = entry;
}

function toMatch(key: string, entry: RepoEntry): RepoMatch {
  const locals = (entry.locals ?? []).filter((p) => existsSync(p));
  return { key, url: httpsUrl(key), names: entry.names, locals };
}

// --- Capture (REPO-06, REPO-07) ---

// Read a directory's origin remote with a read-only git query. Returns null
// when the directory isn't a git repo or has no origin remote (REPO-07: record
// nothing, don't error).
function readOriginRemote(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

// REPO-06: upsert from a recorded deliverable/link URL.
export function recordUrl(url: string): void {
  const key = repoKeyFromForgeUrl(url);
  if (!key) return;
  const db = loadRepos();
  upsert(db, key, { name: repoNameFromKey(key) });
  saveRepos(db);
}

// REPO-07: upsert from the origin remote of a working directory.
export function recordCwd(cwd: string): void {
  const remote = readOriginRemote(cwd);
  if (!remote) return;
  const key = normalizeGitRemote(remote);
  if (!key) return;
  const db = loadRepos();
  upsert(db, key, { name: repoNameFromKey(key), local: cwd });
  saveRepos(db);
}

// CLI-23a: resolve a working directory's origin remote to a normalized repo
// key, or null when the directory isn't a git repo, has no origin, or the
// remote isn't recognizable. The cwd→key half of path-to-route lookup.
export function repoKeyForCwd(cwd: string): string | null {
  const remote = readOriginRemote(cwd);
  if (!remote) return null;
  return normalizeGitRemote(remote);
}

// --- Queries / commands (CLI-42..46) ---

// Match a partial case-insensitively against every repo's names (CLI-42).
export function matchByName(partial: string): RepoMatch[] {
  const q = partial.toLowerCase();
  const db = loadRepos();
  return Object.entries(db)
    .filter(([, e]) => e.names.some((n) => n.toLowerCase().includes(q)))
    .map(([k, e]) => toMatch(k, e))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// Resolve a <match> arg used by alias/rm: an exact normalized key, else a name
// match. Callers requiring a single repo handle the ambiguous/empty cases.
function resolveMatches(match: string): RepoMatch[] {
  const db = loadRepos();
  if (db[match]) return [toMatch(match, db[match])];
  return matchByName(match);
}

function resolveOne(match: string): string {
  const matches = resolveMatches(match);
  if (matches.length === 0) throw new Error(`No repo matches "${match}"`);
  if (matches.length > 1) {
    throw new Error(
      `"${match}" matches ${matches.length} repos: ${matches.map((m) => m.key).join(", ")}`,
    );
  }
  return matches[0].key;
}

export function listRepos(): RepoMatch[] {
  const db = loadRepos();
  return Object.entries(db)
    .map(([k, e]) => toMatch(k, e))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// CLI-44
export function addAlias(match: string, alias: string): RepoMatch {
  const key = resolveOne(match);
  const db = loadRepos();
  const entry = db[key];
  if (!entry.names.includes(alias)) entry.names.push(alias);
  saveRepos(db);
  return toMatch(key, entry);
}

export interface PrunedLocal {
  key: string;
  path: string;
}

// CLI-45: drop stale locals; never remove repo entries themselves.
export function pruneLocals(): PrunedLocal[] {
  const db = loadRepos();
  const removed: PrunedLocal[] = [];
  for (const [key, entry] of Object.entries(db)) {
    if (!entry.locals) continue;
    const kept = entry.locals.filter((p) => {
      if (existsSync(p)) return true;
      removed.push({ key, path: p });
      return false;
    });
    if (kept.length) entry.locals = kept;
    else delete entry.locals;
  }
  if (removed.length) saveRepos(db);
  return removed;
}

export interface RebuildInput {
  urls: string[];
  cwds: string[];
}

export interface RebuildResult {
  repoCount: number;
  urlsMatched: number;
  localsAdded: number;
}

// CLI-47: reconstruct the database from forge URLs and pinned directories in a
// single load/save. Additive — existing aliases and locals are preserved.
export function rebuildFrom(input: RebuildInput): RebuildResult {
  const db = loadRepos();
  let urlsMatched = 0;
  let localsAdded = 0;

  for (const url of input.urls) {
    const key = repoKeyFromForgeUrl(url);
    if (!key) continue;
    urlsMatched++;
    upsert(db, key, { name: repoNameFromKey(key) });
  }

  for (const cwd of input.cwds) {
    const remote = readOriginRemote(cwd);
    if (!remote) continue;
    const key = normalizeGitRemote(remote);
    if (!key) continue;
    const hadLocal = db[key]?.locals?.includes(cwd) ?? false;
    upsert(db, key, { name: repoNameFromKey(key), local: cwd });
    if (!hadLocal) localsAdded++;
  }

  saveRepos(db);
  return { repoCount: Object.keys(db).length, urlsMatched, localsAdded };
}

// CLI-46
export function removeRepo(match: string): RepoMatch {
  const key = resolveOne(match);
  const db = loadRepos();
  const result = toMatch(key, db[key]);
  delete db[key];
  saveRepos(db);
  return result;
}
