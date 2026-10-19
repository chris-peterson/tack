import { type DeliverableStats } from "./forge.js";
import { type SessionUsage } from "./usage.js";
import type { Route } from "./types.js";
export interface SessionStats {
    id: string;
    /** The tacks this session drove on the route being described. */
    tacks: string[];
    /** Other routes it drove tacks on: its whole usage counts toward each. */
    elsewhere: string[];
    /** Null when no transcript is on this machine for it. */
    usage: SessionUsage | null;
}
export interface ChangeEntry {
    url: string;
    label: string;
    stats?: DeliverableStats;
    error?: string;
}
export interface TackStats {
    id: string;
    change?: ChangeEntry;
    sessions: string[];
}
export interface RouteStats {
    slug: string;
    sessions: SessionStats[];
    tacks: TackStats[];
}
export type Probe = (url: string) => Promise<DeliverableStats>;
export declare const OPEN_CHANGE_TTL_MS = 60000;
export declare function cachedProbe(probe: Probe, openTtlMs?: number, now?: () => number): Probe;
export declare function routeStats(r: Route, probe?: Probe): Promise<RouteStats>;
