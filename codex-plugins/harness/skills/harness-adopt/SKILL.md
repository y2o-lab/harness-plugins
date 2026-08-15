---
name: harness-adopt
description: Safely adopt the Harness workflow in an existing repository without replacing its tools. Use when the user asks to introduce, configure, or bootstrap Harness quality checks.
---

# Harness adoption

1. Read the repository's `AGENTS.md`, local skills, CI files, and existing quality configuration before proposing changes.
2. Run `harness detect` and `harness doctor`. Report the selected command, confidence, and evidence for every capability.
3. Treat existing scripts and CI commands as the source of truth. Do not install, replace, or upgrade linters, formatters, test runners, or dependencies unless the user explicitly asks.
4. Run `harness adopt` first. Explain the proposed `harness-settings.json` and any capability that remains unresolved.
5. Only run `harness adopt --write` after the user has explicitly approved the displayed proposal. It is intentionally non-overwriting.
6. Run `harness doctor` and a representative `harness verify --phase stop` after adoption. Distinguish a configuration problem, an unavailable command, and a failed quality check.

Hooks are optional adapters, not enforcement boundaries. Keep lifecycle configuration capability-based and always use the Harness CLI rather than embedding provider-specific commands.
