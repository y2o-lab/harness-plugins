---
name: harness-promote
description: Analyze local Harness events and produce evidence-backed repository or plugin improvement proposals. Use when the user asks to learn from repeated failures or quality friction.
---

# Harness promotion

Read [the shared workflow](../../references/workflow.md) for authorization boundaries, CLI resolution, and proportionate verification. Resolve the CLI once per task.

1. Run `promote analyze` through the resolved CLI before proposing any change. Use `--write` only when the user asks to write the local dashboard.
2. Evaluate recurrence, distinct sessions, days observed, confidence, impact, fixability, and distribution. A raw failure count alone is never enough.
3. Classify the proposal: repository rule/settings, stack provider, or plugin core. Keep uncertainty at Observe or Advisory.
4. Include the evidence, expected cost, rollback path, and the reason for the classification.

Keep proposals local. For a recurring failure, describe a reproducible check and its acceptance criterion. Apply policy changes only when the user requests implementation.
