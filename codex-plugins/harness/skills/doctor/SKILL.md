---
name: harness-doctor
description: Diagnose Harness configuration, discovered quality capabilities, and local event-store health without changing the repository. Use when the user asks why Harness cannot run or what it detected.
---

# Harness diagnosis

Before running a Harness command, resolve the installed CLI from Codex's plugin registry. Run this from the target repository; this shell variable is command-local and must never be requested from the user or persisted in their shell profile:

```bash
HARNESS_CLI="$(codex plugin list | awk '$1 ~ /^harness@/ { path = $NF "/scripts/harness.mjs" } END { print path }')"
test -n "$HARNESS_CLI" && node "$HARNESS_CLI" <command>
```

Run `doctor` through the resolved CLI in read-only mode before proposing a repair.

For each finding, report its status (`pass`, `warning`, `error`, or `not-applicable`), the evidence, and the smallest safe next action. Do not turn a missing provider into an installation task without explicit user approval. A hook warning means that CLI verification remains the reproducible path; it does not mean quality verification succeeded or failed.

When a command fails, run `run <capability>` through the resolved CLI to retain a privacy-minimized local event and report the command's result without exposing environment values or source contents.
