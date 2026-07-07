#!/usr/bin/env node
// Fail if a top-level CLI command isn't offered by shell completion.
//
// The completion script (src/completions.ts) is hand-maintained and easy to
// forget when a command is added to the dispatch switch in src/cli.ts — the
// `export`/`import` commands shipped without it. This is a commit invariant
// (it must hold regardless of who or what edits the files), so it lives in CI
// rather than an editor hook — see scripts/hooks/pre-commit for the same
// reasoning applied to plugin.json.
//
// Direction is one-way on purpose: every CLI command must appear in the
// completion `commands` list. The reverse (a completion-only entry) is allowed
// so meta commands like `help` can be offered without a dispatch case.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliSrc = readFileSync(join(root, "src", "cli.ts"), "utf8");
const complSrc = readFileSync(join(root, "src", "completions.ts"), "utf8");

// Top-level dispatch labels: `    case "<name>": {` inside the command switch.
const cliCommands = new Set(
  [...cliSrc.matchAll(/^    case "([a-z][a-z-]*)":/gm)].map((m) => m[1]),
);

// Completion offerings: `'<name>:<description>'` entries in the commands array.
const complCommands = new Set(
  [...complSrc.matchAll(/^\s*'([a-z][a-z-]*):/gm)].map((m) => m[1]),
);

const missing = [...cliCommands].filter((c) => !complCommands.has(c)).sort();

if (missing.length > 0) {
  console.error(
    "completions drift: these commands exist in src/cli.ts but are missing\n" +
      "from the `commands` list in src/completions.ts:\n" +
      missing.map((c) => `  - ${c}`).join("\n") +
      "\n\nAdd each to the `commands` array (and a `case` handler if it takes\n" +
      "args), then run `npm run build`.",
  );
  process.exit(1);
}

console.log(`completions in sync: ${cliCommands.size} commands offered`);
