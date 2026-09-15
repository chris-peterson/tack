export type SurfaceState = "current" | "stale" | "gone" | "dev";
export interface Surface {
    /** What the reader recognizes it as. */
    label: string;
    /** The installed artifact itself. */
    path: string;
    /** What it points at, or null when the file holds no recognizable target. */
    target: string | null;
    state: SurfaceState;
}
export declare function surfaces(): Surface[];
export interface Drift {
    gone: Surface[];
    stale: Surface[];
}
export declare function drift(): Drift;
/**
 * One line, for the channel Claude Code renders to the user:
 * `<source>: <resolution>  # <reasoning>`. Session banners stack, one per
 * plugin with something to say, so the command to type sits where the eye
 * lands and the rest goes after the marker. Detail belongs in the context,
 * which has no line budget.
 */
export declare function banner(_d: Drift): string;
/** The per-surface breakdown, for the model. */
export declare function report(d: Drift): string;
/**
 * The SessionStart payload, or null when every surface reaches this install.
 *
 * Both channels carry it. `additionalContext` reaches only the model, which is
 * free to answer the prompt in front of it and never mention what it read —
 * the reason this used to open by begging to be relayed, which is a request
 * rather than a mechanism. `systemMessage` is the one hook output Claude Code
 * renders to the user, so the banner is what delivers the finding and the
 * context is what tells the model why.
 */
export declare function sessionStartPayload(): string | null;
