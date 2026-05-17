import type { Route, Tack } from "./types.js";
import { type FindMatch } from "./route.js";
export declare function formatTack(tack: Tack): string;
export declare function formatRoute(route: Route): string;
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
