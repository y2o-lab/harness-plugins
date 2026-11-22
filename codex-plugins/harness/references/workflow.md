# Shared Harness workflow

Use the user's outcome and repository instructions to identify observable acceptance checks. Inspect existing scripts, CI and command overrides relevant to those checks. Keep the user's model, effort, task scope and authorization. A preview or diagnosis is read-only. Installation, publication and external messages need authorization appropriate to those actions.

## Run the CLI

Resolve `../../scripts/harness.mjs` relative to the installed skill file. In the plugin source use `codex-plugins/harness/scripts/harness.mjs`. Invoke it with Node from the target root or pass `--root PATH`. If the installed path is unavailable, locate the installation once with `codex plugin list`.

## Verification loop

1. Identify how to observe the requested change at its normal entry point. Use `plan` when you need to see the selected commands, prerequisites or required checks before execution.
2. Implement the change. Use `run CHECK --summary` for focused feedback while iterating. An exit code from a check and its prerequisites is stronger evidence than a description of intended behavior.
3. Use `verify --summary` for the final phase. Inspect every reported status, including advisory failures and blocked dependents. After a failure, inspect the first incomplete prerequisite, change the input or repair the cause, then recheck. End automatic repair when the same evidence recurs. Report the concrete blocker and completed independent work.
4. Finish once the requested behavior and required checks pass. Keep the objective, constraints, changed paths, evidence and outstanding work across steering and compaction. Record a repeatable regression as a repository check when it warrants one.
