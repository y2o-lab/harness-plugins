---
name: harness-work
description: Implement or refactor repository code with Harness quality checks and model-aware guidance for Astra, Sol, Terra, and Luna. Use when the user asks to do development work with Harness; diagnosis alone uses harness-doctor.
---

# Development with Harness

Read [the shared workflow](../../references/workflow.md). Resolve the CLI as described there, and run `guide --model <current-model>` once if the current model is explicitly known; otherwise run `guide` for shared guidance. The guide is advisory and does not select or reconfigure a model.

Use `detect` to identify existing checks. Implement the requested result and run the relevant capabilities with `run <capability>`. Use `verify` to finish configured lifecycle and required checks. Preserve verification evidence for unchanged code during this task; rerun when edits, failures, changed dependencies, or required repository rules justify it.

Keep the user's original objective, constraints, completed changes, check results, and remaining work through steering and compaction. Continue authorized independent work while a clarification is pending. If blocked, explain the specific missing input or authority and the completed work.

Report the result, checks actually run, and remaining limitations. An advisory failure is a finding to disclose; an unresolved required check prevents a claim that verification passed.
