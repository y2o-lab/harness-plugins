---
name: harness-doctor
description: Diagnose Harness configuration, discovered quality capabilities, and local event-store health without changing the repository. Use when the user asks why Harness cannot run or what it detected.
---

# Harness diagnosis

Read [the shared workflow](../../references/workflow.md) for authorization boundaries, CLI resolution, and proportionate verification. Resolve the CLI once per task.

Run `doctor` through the resolved CLI in read-only mode before proposing a repair.

For each finding, report its status (`pass`, `warning`, `error`, or `not-applicable`), the evidence, and the smallest safe next action. Do not turn a missing provider into an installation task without explicit user approval. A hook warning means that CLI verification remains the reproducible path; it does not mean quality verification succeeded or failed.

Diagnosis is read-only: inspect existing events and configuration without rerunning repository scripts or writing events. If execution is needed, report the exact command and why; run it only when verification or repair is within the user's request.
