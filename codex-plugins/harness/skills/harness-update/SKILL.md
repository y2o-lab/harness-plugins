---
name: harness-update
description: Safely update a repository already using Harness while preserving local overrides and explaining compatibility changes. Use when the user asks to upgrade or migrate Harness settings.
---

# Harness update

Read [the shared workflow](../../references/workflow.md) for authorization boundaries, CLI resolution, and proportionate verification. Resolve the CLI once per task.

Start with `doctor` through the resolved CLI and inspect the existing `harness-settings.json`. Preserve explicit commands, provider choices, and policy modes outside the requested migration scope.

For an authorized schema or plugin update, explain affected files and compatibility changes, then merge the scoped changes while preserving local overrides. Do not replace the settings file wholesale. Verify through `doctor` and the relevant checks, including `verify --phase stop`; reuse checks already passed for unchanged inputs. If asked only for a migration plan, return the plan without edits.
