import { type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { Route } from "./types.js";
export declare const DEFAULT_PORT = 8788;
export declare function hyperlinkBase(env?: NodeJS.ProcessEnv, isTty?: boolean): string | null;
export declare function renderRoute(r: Route, opts?: {
    crumb?: boolean;
    editable?: boolean;
    linkTacks?: boolean;
}): string;
export declare function renderIndex(routes: Route[]): string;
export declare function renderGroup(group: string, routes: Route[]): string;
export declare function prefersJson(accept: string | undefined): boolean;
export declare function handle(req: IncomingMessage, res: ServerResponse): void;
export declare function serve(port?: number): Server;
