import { type IncomingMessage, type ServerResponse, type Server } from "node:http";
import * as route from "./route.js";
import * as stats from "./stats.js";
import type { Route, Tack } from "./types.js";
export declare const DEFAULT_PORT = 8788;
export declare function hyperlinkBase(env?: NodeJS.ProcessEnv, isTty?: boolean): string | null;
export declare function renderRoute(r: Route, opts?: {
    routes?: Route[];
}): string;
export declare function renderRouteStats(r: Route, s: stats.RouteStats, now?: number): string;
export declare function renderTackStats(r: Route, t: Tack, s: stats.RouteStats, now?: number): string;
export declare function renderTack(r: Route, t: Tack, routes?: Route[]): string;
export declare function renderIndex(routes: Route[], invalid?: route.InvalidRoute[]): string;
export declare function indexFilters(routes: Route[]): string;
export declare function tackFilters(tacks: Tack[]): string;
export declare function renderGroup(group: string, routes: Route[], all?: Route[]): string;
export declare function prefersJson(accept: string | undefined): boolean;
export interface HandleOptions {
    /** Reads a change request's stats; the forge CLIs by default. */
    probe?: stats.Probe;
    /** Browser origins that may read and write ([SERVE-23]); the config file's by default. */
    allowedOrigins?: string[];
}
export declare function handle(req: IncomingMessage, res: ServerResponse, opts?: HandleOptions): void;
export declare function renderPinTiles(keys: string[], routes: Route[], probe?: stats.Probe, now?: number): Promise<string>;
export declare function serve(port?: number, opts?: HandleOptions): Server;
