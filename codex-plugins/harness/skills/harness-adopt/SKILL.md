---
name: harness-adopt
description: Safely adopt the Harness workflow in an existing repository without replacing its tools. Use when the user asks to introduce, configure, or bootstrap Harness quality checks.
---

# Harness adoption

Before running a Harness command, resolve the installed CLI from Codex's plugin registry. Run this from the target repository; this shell variable is command-local and must never be requested from the user or persisted in their shell profile:

```bash
HARNESS_CLI="$(codex plugin list | awk '$1 ~ /^harness@/ { path = $NF "/scripts/harness.mjs" } END { print path }')"
test -n "$HARNESS_CLI" && node "$HARNESS_CLI" <command>
```

1. Read the repository's `AGENTS.md`, local skills, CI files, and existing quality configuration before proposing changes.
2. Run `detect` and `doctor` through the resolved CLI. Report the selected command, confidence, and evidence for every capability.
3. Treat existing scripts and CI commands as the source of truth. Do not install, replace, or upgrade linters, formatters, test runners, or dependencies unless the user explicitly asks.
4. Run `adopt` through the resolved CLI first. Explain the proposed `harness-settings.json` and any capability that remains unresolved.
5. Only run `adopt --write` through the resolved CLI after the user has explicitly approved the displayed proposal. It is intentionally non-overwriting.
6. Run `doctor` and a representative `verify --phase stop` through the resolved CLI after adoption. Distinguish a configuration problem, an unavailable command, and a failed quality check.

Hooks are optional adapters, not enforcement boundaries. Keep lifecycle configuration capability-based and always use the Harness CLI rather than embedding provider-specific commands.
