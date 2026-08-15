---
name: harness-doctor
description: Diagnose Harness configuration, discovered quality capabilities, and local event-store health without changing the repository. Use when the user asks why Harness cannot run or what it detected.
---

# Harness diagnosis

Run `harness doctor` in read-only mode before proposing a repair.

For each finding, report its status (`pass`, `warning`, `error`, or `not-applicable`), the evidence, and the smallest safe next action. Do not turn a missing provider into an installation task without explicit user approval. A hook warning means that CLI verification remains the reproducible path; it does not mean quality verification succeeded or failed.

When a command fails, run the selected `harness run <capability>` to retain a privacy-minimized local event and report the command's result without exposing environment values or source contents.
