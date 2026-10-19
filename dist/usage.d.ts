export declare const IDLE_GAP_S = 300;
export interface Tokens {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
}
export interface SessionUsage {
    id: string;
    /** Basename of the directory the session ran in. */
    cwd?: string;
    first: string;
    last: string;
    /** Sum of the gaps between records that are at most IDLE_GAP_S long. */
    active_s: number;
    /** Prompts the user typed, slash commands included. */
    prompts: number;
    /** API responses, sub-agents included. */
    requests: number;
    tokens: Tokens;
    subagents: number;
}
export declare function transcriptPath(id: string): string | null;
export declare function sessionUsage(id: string): SessionUsage | null;
export declare function totalTokens(t: Tokens): number;
