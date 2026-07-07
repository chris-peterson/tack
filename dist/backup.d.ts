import * as route from "./route.js";
import * as repos from "./repos.js";
import type { Route } from "./types.js";
export declare const SCHEMA_VERSION = 1;
export interface Archive {
    schemaVersion: number;
    exportedAt: string;
    generator: string;
    routes: Route[];
    repos: repos.RepoDb;
    pins: ReturnType<typeof route.readAllPins>;
}
export interface ExportResult {
    buffer: Buffer;
    counts: {
        routes: number;
        repos: number;
        pins: number;
    };
}
export declare function buildArchive(generator: string): ExportResult;
export declare function parseArchive(buf: Buffer): Archive;
export interface Reassignment {
    from: string;
    to: string;
    summary: string;
}
export interface MergedRoute {
    slug: string;
    added: number;
    skipped: number;
    reassignments: Reassignment[];
}
export interface ImportResult {
    mode: "merge" | "replace";
    dryRun: boolean;
    created: string[];
    replaced: string[];
    merged: MergedRoute[];
    reposKeysAdded: number;
    reposNamesAdded: number;
    pinsRestored: number;
}
export declare function applyImport(archive: Archive, opts: {
    mode: "merge" | "replace";
    dryRun: boolean;
}): ImportResult;
