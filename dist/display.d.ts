import type { Route, Tack } from "./types.js";
import { type FindMatch } from "./route.js";
export declare function formatTack(tack: Tack): string;
export declare function formatRoute(route: Route): string;
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
    group?: string;
    total: number;
    open: number;
}[]): string;
