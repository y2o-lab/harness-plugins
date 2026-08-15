---
name: harness-promote
description: Analyze local Harness events and produce evidence-backed repository or plugin improvement proposals. Use when the user asks to learn from repeated failures or quality friction.
---

# Harness promotion

1. Run `harness promote analyze` before proposing any change. Use `--write` only when the user asks to write the local dashboard.
2. Evaluate recurrence, distinct sessions, days observed, confidence, impact, fixability, and distribution. A raw failure count alone is never enough.
3. Classify the proposal: repository rule/settings, stack provider, or plugin core. Keep uncertainty at Observe or Advisory.
4. Include the evidence, expected cost, rollback path, and the reason for the classification.

This MVP never creates, updates, or searches GitHub issues. It must not change `AGENTS.md`, change a capability to `required`, install dependencies, or alter plugin defaults automatically. Those are human-review decisions.
