import type { Route, Session, TackStatus } from "./types.js";
type UrlEntry = string | {
    url: string;
    label?: string;
};
interface StoreTack {
    id: string;
    summary: string;
    status?: TackStatus;
    done_at?: string;
    depends_on?: string[];
    deliverable?: string;
    urls?: UrlEntry[];
}
interface StoreRoute {
    slug: string;
    id: string;
    created_at: string;
    group?: string;
    title?: string;
    description?: string;
    sessions?: Session[];
    tacks?: StoreTack[];
}
export interface ProjectReport {
    routes: number;
    tacks: number;
    created: string[];
    updated: string[];
    unchanged: number;
    carried: number;
}
export declare function resolveStore(explicit?: string): string;
export declare function readStore(root: string): StoreRoute[];
export declare function toRoute(stored: StoreRoute, prior?: Route): Route;
export declare function project(opts?: {
    store?: string;
    dryRun?: boolean;
}): ProjectReport;
export {};
