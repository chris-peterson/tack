export declare function gitlabRef(url: string): {
    host: string;
    project: string;
    iid: string;
} | null;
export declare function githubPr(url: string): boolean;
/** Whether `deliverableStats` has a reader for this URL. */
export declare function hasStats(url: string): boolean;
export declare function run(cmd: string, args: string[], url: string): string;
export type ChangeState = "draft" | "open" | "merged" | "closed";
interface Size {
    additions: number;
    deletions: number;
    files: number;
}
export interface ChangeStats extends Size {
    kind: "change_request";
    state: ChangeState;
    opened_at: string;
    merged_at?: string;
    closed_at?: string;
    commits: number;
}
export interface CommitStats extends Size {
    kind: "commit";
    committed_at: string;
}
export type DeliverableStats = ChangeStats | CommitStats;
export declare function deliverableStats(url: string): Promise<DeliverableStats>;
export {};
