# Shared Harness workflow

User instructions and existing authorization take precedence over skill guidelines, subject to higher-priority instructions and execution permissions. A request to implement, fix, or adopt authorizes routine local work within that scope. Prepare and inspect concrete changes before asking for any genuinely missing decision. A request only for a preview, diagnosis, or report stays read-only. Do not add approval steps for work already authorized.

When a skill actually blocks work, cite the exact file and instruction, and explain why existing authorization does not cover the next action. Do not infer permission to publish, send messages, replace quality tools, or change unrelated settings.

## Resolve the CLI

If working on this plugin's source, use its `scripts/harness.mjs`. Otherwise resolve `../../scripts/harness.mjs` relative to the actual installed SKILL.md you read (all bundled skills have this layout). Use an absolute path and run from the target repository, or pass `--root`. Confirm the file exists. Only fall back to `codex plugin list` if that relative path is unavailable; do not repeatedly rediscover the same installation or ask the user to set environment variables.

## Efficient execution

Keep instructions and tool results focused on the current decision. Read linked model guidance only for the active model. Preserve the user's chosen model and reasoning effort; no automatic escalation, model switch, or universal max effort. Measure task success, check failures, total time, and tokens before claiming a better setting.

Batch independent read-only operations when useful. Run checks sequentially unless the repository establishes they can run concurrently without sharing mutable outputs. Delegate only when available and allowed by the active session, and an independent task has clear ownership, inputs, completion criteria, and integration value. Do not require subagents or nested delegation for routine changes.

Use the existing checks appropriate to the change and required policy. Once those pass, finish unless new changes or evidence justify more verification. Do not add tests that only restate a reversible cosmetic edit. Never treat a skipped, timed-out, unavailable, or truncated check as proof of success; exit status and reported truncation remain visible.

## Continuity

Stay in the active Codex task. Preserve concise factual state across compaction: objective, user constraints and authorization, changed paths, decisions, verification evidence, pending work, and actual blockers. Do not restart completed research or checks just because context was compacted. Do not ask for or record private reasoning traces. Native reasoning persistence and compaction belong to the Codex host, not this plugin's event log.
