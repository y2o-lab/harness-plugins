---
name: harness-update
description: Safely update a repository already using Harness while preserving local overrides and explaining compatibility changes. Use when the user asks to upgrade or migrate Harness settings.
---

# Harness update

Before running a Harness command, resolve the installed CLI from Codex's plugin registry. Run this from the target repository; this shell variable is command-local and must never be requested from the user or persisted in their shell profile:

```bash
HARNESS_CLI="$(codex plugin list | awk '$1 ~ /^harness@/ { path = $NF "/scripts/harness.mjs" } END { print path }')"
test -n "$HARNESS_CLI" && node "$HARNESS_CLI" <command>
```

Start with `doctor` through the resolved CLI and inspect the existing `harness-settings.json`. Preserve explicit commands, provider choices, and policy modes unless the user approves a change.

For a schema or plugin update, present a migration plan with affected files, compatibility risks, and rollback. Never overwrite settings. Verify the result through `doctor` and `verify --phase stop` using the resolved CLI; hooks may be tested as an additional best-effort path only.
