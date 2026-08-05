export interface MergeState {
    merged: boolean;
    mergedAt?: string;
}
export interface Reconciled {
    slug: string;
    tackId: string;
    summary: string;
    url: string;
    mergedAt: string;
}
export declare function mergeState(url: string): MergeState;
export declare function reconcile(opts?: {
    slug?: string;
    dryRun?: boolean;
    probe?: (url: string) => MergeState;
}): Reconciled[];
