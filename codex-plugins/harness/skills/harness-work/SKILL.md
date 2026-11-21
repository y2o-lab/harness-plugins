---
name: harness-work
description: Implement or refactor repository code using Harness verification, dependency plans, and focused repair feedback. Use when the user asks for development with Harness.
---

# Develop with Harness

Follow the [shared verification workflow](../../references/workflow.md). Start from the user's observable acceptance criteria. For a simple task, go straight to the relevant command. For a multi-check task, inspect the dependency plan when it clarifies execution or scope.

Every model uses the same verification policy. If an explicit model needs tailored guidance, `guide --model ID` returns the shared workflow and any available profile. Omit this call if the workflow already provides enough context.

Report the behavior verified, checks that actually ran and unresolved findings. Treat a blocked required check as incomplete.
