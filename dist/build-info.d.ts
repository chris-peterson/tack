/**
 * Whether this copy is a working tree rather than an installed plugin. Claude
 * Code extracts a marketplace install as plain files, so a `.git` entry at the
 * package root is present in exactly one of the two. Read at the package root,
 * not the working directory, which is a git repository on most ordinary runs.
 */
export declare function isDevBuild(): boolean;
/**
 * The version to print, marking an unpublished build with the commit it came
 * from. The `g` prefix keeps the identifier valid semver: a sha of all digits
 * would read as a numeric identifier, which may not carry leading zeros. Where
 * no commit can be read the marker survives alone, since the marker is the
 * answer and the ref is the detail.
 */
export declare function describeVersion(version: string): string;
