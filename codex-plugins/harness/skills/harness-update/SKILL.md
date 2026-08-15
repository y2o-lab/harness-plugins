---
name: harness-update
description: Safely update a repository already using Harness while preserving local overrides and explaining compatibility changes. Use when the user asks to upgrade or migrate Harness settings.
---

# Harness update

Start with `harness doctor` and inspect the existing `harness-settings.json`. Preserve explicit commands, provider choices, and policy modes unless the user approves a change.

For a schema or plugin update, present a migration plan with affected files, compatibility risks, and rollback. Never overwrite settings. Verify the result through `harness doctor` and `harness verify --phase stop`; hooks may be tested as an additional best-effort path only.
