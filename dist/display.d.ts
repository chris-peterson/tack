import type { Route, Tack } from "./types.js";
import { type FindMatch, type PinEntry } from "./route.js";
import type { RepoMatch } from "./repos.js";
export declare function formatTack(tack: Tack, opts?: {
    url?: string;
}): string;
export declare function formatRoute(route: Route, opts?: {
    linkBase?: string | null;
}): string;
/**
 * The structured data behind `formatTree`, for `tack tree --json`. The shape
 * mirrors the navigation depth: all routes (no path), one route (slug), one
 * tack (slug/tack), or a single aspect value (slug/tack/aspect). Glob paths
 * return a flat array of matches whose shape varies by pattern depth.
 */
export declare function treeData(routes: Route[], path?: string): unknown;
export declare function formatTree(routes: Route[], path?: string, depth?: number): string;
export declare function formatRecent(routes: {
    slug: string;
    group?: string;
    updated_at: string;
    total: number;
    open: number;
}[]): string;
export declare function formatFind(matches: FindMatch[]): string;
export declare function formatList(routes: {
    slug: string;
    title?: string;
    group?: string;
    total: number;
    open: number;
    state?: "active" | "done";
}[]): string;
export declare function formatPins(pins: PinEntry[]): string;
export declare function formatRepos(repos: RepoMatch[]): string;
