# Harness engineering notes

## Sources consulted

- OpenAI, [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/ja-JP/index/harness-engineering/) (2026-02-11).
- OpenAI Developers, [Build plugins](https://developers.openai.com/codex/plugins/).
- OpenAI, [Codex hooks](https://learn.chatgpt.com/docs/hooks.md).
- Nexu, [Harness Engineering Guide](https://github.com/nexu-io/harness-engineering-guide) (supplementary, non-authoritative).

## Decisions applied here

1. **Make repository knowledge inspectable, concise, and progressively disclosed.** OpenAI advises treating `AGENTS.md` as a map rather than an encyclopaedia, with durable detail in structured documentation. This plugin keeps Skills short, puts policy in `harness-settings.json`, and makes the CLI print evidence for each decision.
2. **Enforce invariants, not an implementation preference.** The public interface is capability-first (`lint`, `format`, `typecheck`, `test`, `build`). A provider is an evidence-backed implementation choice, so an existing `pnpm lint` wins over a guessed linter executable.
3. **Use an executable feedback loop.** Skills provide judgment and reporting; `harness` performs detection, validation, execution, event recording, and promotion analysis. Hook adapters only invoke the same CLI, so hooks are never the sole enforcement path.
4. **Keep safety boundaries and automation levels explicit.** `off`, `advisory`, and `required` distinguish observation from a quality gate. `adopt` is dry-run by default; writing settings requires `--write`. Promotion is local and advisory by default; no GitHub mutation exists in the MVP.
5. **Turn repeated failure into evidence, not automatic policy.** Events retain no source contents, environment values, or command arguments. Promotion deduplicates by fingerprint and evaluates recurrence, confidence, impact, fixability, and distribution before producing a Markdown proposal.
6. **Prefer fast, scoped feedback without hiding uncertainty.** Changed-file strategy is used only for providers that can receive files. If a partial command cannot be established safely, the plan reports the fallback and runs the repository command unchanged.

## MVP boundary

The implementation intentionally supports Node.js/TypeScript repository discovery first. It recognizes package-manager lockfiles and package scripts, then reports unknown capability states rather than installing dependencies or guessing destructive changes. Cross-repository aggregation, automatic issue creation, provider replacement, and automatic escalation to `required` remain outside the MVP.

## Hook contract

The bundled hook file uses Codex's supported `PreToolUse`, `PostToolUse`, and
`Stop` events. Commands resolve from `PLUGIN_ROOT`, read event JSON from stdin,
and return only small structured status messages. `PreToolUse` blocks only a
short, high-confidence set of irrecoverably destructive shell patterns; all
other checks are advisory. `PostToolUse` and `Stop` delegate to the same CLI as
manual verification, so a disabled, untrusted, or timed-out hook never creates
a second or hidden quality path.
