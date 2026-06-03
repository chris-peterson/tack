import type { Link, Route, Tack, TackStatus } from "./types.js";
export declare function isOpen(t: Tack): boolean;
export declare function loadAll(): Route[];
export declare function normalizeTimestamp(input: string): string;
export declare function load(slug: string): Route;
export declare function init(slug: string, opts?: {
    group?: string;
}): Route;
export declare function list(): {
    slug: string;
    group?: string;
    total: number;
    open: number;
}[];
export declare function addTack(slug: string, summary: string, opts?: {
    dependsOn?: string[];
    done?: boolean;
    doneAt?: string;
    deliverable?: {
        label: string;
        url: string;
    };
}): Tack;
export declare function markDone(slug: string, tackId: string, opts?: {
    at?: string;
}): {
    tack: Tack;
    pendingTodo: string[];
    ambiguousDeliverable: Link[];
};
export declare function markDropped(slug: string, tackId: string): Tack;
export declare function startTack(slug: string, tackId: string): Tack;
export declare function setStatus(slug: string, tackId: string, status: TackStatus): Tack;
export declare function addDependency(slug: string, tackId: string, depId: string): Tack;
export declare function removeDependency(slug: string, tackId: string, depId: string): Tack;
export declare function rename(oldSlug: string, newSlug: string): Route;
export declare function setDeliverable(slug: string, tackId: string, label: string, url: string, opts?: {
    force?: boolean;
}): Tack;
export declare function addBefore(slug: string, tackId: string, text: string): Tack;
export declare function addAfter(slug: string, tackId: string, text: string): Tack;
export declare function completeTodo(slug: string, tackId: string, todoId: string): Tack;
export declare function dropTodo(slug: string, tackId: string, todoId: string): Tack;
export declare function deriveDeliverableLabel(url: string): string;
export declare function addLink(slug: string, tackId: string, label: string, url: string): Tack;
export declare function removeLink(slug: string, tackId: string, url: string): Tack;
export declare function editTack(slug: string, tackId: string, summary: string): Tack;
export declare function mergeTacks(slug: string, sourceId: string, targetId: string): Tack;
export declare function recordSession(slug: string, sessionId: string): Route;
export declare function recent(opts?: {
    count?: number;
    since?: string;
}): {
    slug: string;
    group?: string;
    updated_at: string;
    total: number;
    open: number;
}[];
export interface FindMatch {
    slug: string;
    group?: string;
    routeTotal: number;
    routeOpen: number;
    tackId: string;
    summary: string;
    status: string;
    done_at?: string;
    match: "deliverable" | "link";
    label: string;
    url: string;
}
export declare function find(url: string): FindMatch[];
export declare function remove(slug: string): void;
export interface Pin {
    slug: string;
    pinned_at: string;
    session_id?: string;
}
export declare function readPin(cwd?: string): Pin | null;
export declare function writePin(slug: string, cwd?: string): Pin;
export declare function deletePin(cwd?: string): boolean;
export interface PinEntry extends Pin {
    path: string;
    dangling: boolean;
    idle: boolean;
}
export declare function listPins(): PinEntry[];
export interface PruneResult {
    path: string;
    slug: string;
    reason: "dangling route" | "missing directory";
}
export declare function prunePins(): PruneResult[];
export interface MoveResult {
    srcRoute: Route;
    dstRoute: Route;
    moved: {
        srcId: string;
        dstId: string;
        summary: string;
    }[];
}
export declare function moveTack(srcSlug: string, srcTackId: string, dstSlug: string, opts?: {
    includeDependents?: boolean;
}): MoveResult;
export declare function removeTack(slug: string, tackId: string, opts?: {
    force?: boolean;
}): Route;
