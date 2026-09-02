export declare function shouldAnnounce(env?: NodeJS.ProcessEnv): boolean;
export declare function announce(key: string, fields: Record<string, unknown>, opts?: {
    env?: NodeJS.ProcessEnv;
    out?: (line: string) => void;
}): boolean;
export declare function announceOnce(key: string, sessionId: string, fields: Record<string, unknown>, opts?: {
    env?: NodeJS.ProcessEnv;
    out?: (line: string) => void;
}): boolean;
