---
description: Install or refresh the tack CLI wrapper and its zsh completions on PATH
argument-hint: "[--dir <path>]"
disable-model-invocation: true
---

Run tack's install bootstrap, then report its output as-is. Do no other work.

<!-- This command exists because it is the only door to the *newly installed*
plugin root. The wrapper at ~/.local/bin/tack hardcodes a version-pinned path at
install time, so after a plugin upgrade `tack install-cli` from the shell
re-points the wrapper at the version it already names. `${CLAUDE_PLUGIN_ROOT}`
is the new one — and it runs before `tack` is on PATH at all. -->

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/tack" install-cli ${ARGUMENTS}
```

Every step is idempotent, so re-running it is the normal way to recover from
drift — the SessionStart freshness hook nudges you here when `tack --version`
falls behind the plugin.
