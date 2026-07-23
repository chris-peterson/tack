export interface RepoEntry {
    names: string[];
    locals?: string[];
}
export type RepoDb = Record<string, RepoEntry>;
export interface RepoMatch {
    key: string;
    url: string;
    names: string[];
    locals: string[];
}
export declare function normalizeGitRemote(remote: string): string | null;
export declare function repoKeyFromForgeUrl(url: string): string | null;
export declare function repoNameFromKey(key: string): string;
export declare function httpsUrl(key: string): string;
export declare function loadRepos(): RepoDb;
export declare function saveReplace(db: RepoDb): void;
export declare function recordUrl(url: string): void;
export declare function recordCwd(cwd: string): void;
export declare function repoKeyForCwd(cwd: string): string | null;
export declare function matchByName(partial: string): RepoMatch[];
export declare function listRepos(): RepoMatch[];
export declare function addAlias(match: string, alias: string): RepoMatch;
export interface PrunedLocal {
    key: string;
    path: string;
}
export declare function pruneLocals(): PrunedLocal[];
export interface RebuildInput {
    urls: string[];
    cwds: string[];
}
export interface RebuildResult {
    repoCount: number;
    urlsMatched: number;
    localsAdded: number;
}
export declare function rebuildFrom(input: RebuildInput): RebuildResult;
export declare function removeRepo(match: string): RepoMatch;
