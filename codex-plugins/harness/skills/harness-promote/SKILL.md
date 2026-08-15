---
name: harness-promote
description: Analyze local Harness events and produce evidence-backed repository or plugin improvement proposals. Use when the user asks to learn from repeated failures or quality friction.
---

# Harness promotion

Before running a Harness command, resolve the installed CLI from Codex's plugin registry. Run this from the target repository; this shell variable is command-local and must never be requested from the user or persisted in their shell profile:

```bash
HARNESS_CLI="$(codex plugin list | awk '$1 ~ /^harness@/ { path = $NF "/scripts/harness.mjs" } END { print path }')"
test -n "$HARNESS_CLI" && node "$HARNESS_CLI" <command>
```

1. Run `promote analyze` through the resolved CLI before proposing any change. Use `--write` only when the user asks to write the local dashboard.
2. Evaluate recurrence, distinct sessions, days observed, confidence, impact, fixability, and distribution. A raw failure count alone is never enough.
3. Classify the proposal: repository rule/settings, stack provider, or plugin core. Keep uncertainty at Observe or Advisory.
4. Include the evidence, expected cost, rollback path, and the reason for the classification.

This MVP never creates, updates, or searches GitHub issues. It must not change `AGENTS.md`, change a capability to `required`, install dependencies, or alter plugin defaults automatically. Those are human-review decisions.
