import * as repos from "./repos.js";
import type { Link, Route, Session, Tack, TackStatus } from "./types.js";
export declare function storeRoot(): string;
export declare function isOpen(t: Tack): boolean;
export declare function routeState(route: Route): "active" | "done";
export declare function assertValidSlug(slug: string, what?: string): void;
export declare function sanitizeRoute(route: Route): Route;
export interface InvalidRoute {
    slug: string;
    file: string;
    errors: string[];
}
export declare function invalidRoutes(): InvalidRoute[];
export declare function clearInvalidRoutes(): void;
export declare function scanAll(): Route[];
export declare function loadAll(): Route[];
export declare function normalizeTimestamp(input: string): string;
export declare function load(slug: string): Route;
export declare function writeRoute(route: Route): void;
export declare function routeExists(slug: string): boolean;
export declare function init(slug: string, opts?: {
    group?: string;
}): Route;
export declare function list(): {
    slug: string;
    title?: string;
    group?: string;
    total: number;
    open: number;
    state: "active" | "done";
}[];
export declare function normalizeTackId(id: string): string;
/**
 * A `depends_on` entry addresses a tack either in the route carrying it (bare
 * `t<N>`) or in another route (`<slug>/t<N>`) [DEPENDS-02]. Resolving one always
 * needs the carrying route's slug — that is what makes the bare form concrete.
 */
export interface DepRef {
    slug: string;
    tackId: string;
}
export declare function parseDepRef(entry: string, localSlug: string): DepRef;
export declare function formatDepRef(ref: DepRef, localSlug: string): string;
/**
 * Every `<slug>/t<N>` reference to `targetSlug` held by any other route, so a
 * rename can rewrite them [DEPENDS-05] and a delete can refuse over them
 * [DEPENDS-06].
 */
export interface InboundRef {
    /** Route holding the dependent tack. */
    slug: string;
    /** The dependent tack's id within that route. */
    from: string;
    /** The tack being depended on, in `targetSlug`. */
    target: string;
    /** The `depends_on` entry verbatim, for an exact-match rewrite or strip. */
    dependsOn: string;
}
export declare function inboundRefs(targetSlug: string, tackId?: string): InboundRef[];
export declare function addTack(slug: string, summary: string, opts?: {
    dependsOn?: string[];
    done?: boolean;
    doneAt?: string;
    deliverable?: {
        label: string;
        url: string;
    };
    links?: Link[];
}): Tack;
export declare function markDone(slug: string, tackId: string, opts?: {
    at?: string;
}): {
    tack: Tack;
    ambiguousDeliverable: Link[];
};
export declare function markDropped(slug: string, tackId: string): Tack;
export declare function startTack(slug: string, tackId: string): Tack;
export declare function setStatus(slug: string, tackId: string, status: TackStatus): Tack;
export declare function addDependency(slug: string, tackId: string, depId: string): Tack;
export declare function removeDependency(slug: string, tackId: string, depId: string): Tack;
export declare function rename(oldSlug: string, newSlug: string): Route;
export declare function setGroup(slug: string, group: string): Route;
export declare function clearGroup(slug: string): Route;
export declare function setTitle(slug: string, title: string): Route;
export declare function clearTitle(slug: string): Route;
export declare function setDescription(slug: string, description: string): Route;
export declare function clearDescription(slug: string): Route;
export declare function setDeliverable(slug: string, tackId: string, label: string, url: string, opts?: {
    force?: boolean;
}): Tack;
export declare function removeDeliverable(slug: string, tackId: string, opts?: {
    toLink?: boolean;
}): Tack;
export declare function isPrOrMrUrl(url: string): boolean;
export declare function deriveDeliverableLabel(url: string): string;
export declare function addLink(slug: string, tackId: string, label: string, url: string): Tack;
export declare function removeLink(slug: string, tackId: string, url: string): Tack;
export declare function editTack(slug: string, tackId: string, summary: string): Tack;
export declare function mergeTacks(slug: string, sourceId: string, targetId: string): Tack;
export declare function sessionWork(slug: string, sessionId: string): {
    route: Route;
    tacks: string[];
    deliverables: string[];
};
export declare function recordSession(slug: string, sessionId: string, tackId?: string): Route;
export declare function sessionsOn(slug: string): Session[];
export declare function endSession(slug: string, sessionId: string): {
    route: Route;
    tacks: string[];
    deliverables: string[];
};
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
export declare function canonicalizeUrl(url: string): string;
export declare function find(url: string): FindMatch[];
export declare function findByRepoKey(key: string): FindMatch[];
export declare function findCollisions(url: string, exclude: {
    slug: string;
    tackId: string;
}): FindMatch[];
export declare function rebuildRepos(): repos.RebuildResult;
export interface DanglingRef {
    slug: string;
    tackId: string;
    dependsOn: string;
    reason: "no such route" | "no such tack";
}
export interface DoctorReport {
    files: number;
    invalid: InvalidRoute[];
    dangling: DanglingRef[];
}
/**
 * `depends_on` entries pointing at a route or tack that isn't there [DEPENDS-07].
 * A dangling edge is valid against the schema — it is a well-formed reference to
 * something absent — so it can only be found by resolving, not by loading.
 */
export declare function danglingRefs(routes?: Route[]): DanglingRef[];
export declare function doctor(): DoctorReport;
export declare function remove(slug: string, opts?: {
    force?: boolean;
}): void;
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
export interface MergeRoutesResult {
    route: Route;
    sources: {
        slug: string;
        moved: {
            srcId: string;
            dstId: string;
            summary: string;
        }[];
    }[];
}
export declare function mergeRoutes(newSlug: string, srcSlugs: string[], opts?: {
    group?: string;
    createdAt?: string;
}): MergeRoutesResult;
export declare function removeTack(slug: string, tackId: string, opts?: {
    force?: boolean;
}): Route;
