---
name: harness-adopt
description: Safely adopt the Harness workflow in an existing repository without replacing its tools. Use when the user asks to introduce, configure, or bootstrap Harness quality checks.
---

# Harness adoption

Read [the shared workflow](../../references/workflow.md) for authorization boundaries, CLI resolution, and proportionate verification. Resolve the CLI once per task.

1. Read the repository's `AGENTS.md`, local skills, CI files, and existing quality configuration before proposing changes.
2. Run `detect` and `doctor` through the resolved CLI. Report the selected command, confidence, and evidence for every capability.
3. Treat existing scripts and CI commands as the source of truth. Do not install, replace, or upgrade linters, formatters, test runners, or dependencies unless the user explicitly asks.
4. Run `adopt` through the resolved CLI first. Explain the proposed `harness-settings.json` and any capability that remains unresolved.
5. If the user requested installation or adoption, inspect the dry-run proposal and run `adopt --write` within that authorization. If the request is only for a preview, stop after the proposal. Ask only for a material choice or authority not already provided. The command is intentionally non-overwriting.
6. Run `doctor` and a representative `verify --phase stop` through the resolved CLI after adoption. Distinguish a configuration problem, an unavailable command, and a failed quality check.

Hooks are optional adapters, not enforcement boundaries. Keep lifecycle configuration capability-based and always use the Harness CLI rather than embedding provider-specific commands.
