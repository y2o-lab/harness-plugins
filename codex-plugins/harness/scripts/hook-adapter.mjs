#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { evaluateToolGuard, verify } from "../core/harness-core.mjs"

const phase = process.argv[2]
const input = await new Promise((resolveInput) => {
  let raw = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => { raw += chunk })
  process.stdin.on("end", () => { try { resolveInput(JSON.parse(raw || "{}")) } catch { resolveInput({}) } })
})
const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd()
if (!["postEdit", "stop", "preCommand"].includes(phase)) {
  process.stderr.write("Harness hook adapter requires postEdit, stop, or preCommand.\n")
  process.exitCode = 2
} else if (phase === "preCommand") {
  let settings = null
  try { settings = JSON.parse(await readFile(resolve(cwd, "harness-settings.json"), "utf8")) } catch {}
  const guard = evaluateToolGuard(input.tool_input?.command, settings)
  if (guard.decision === "deny") process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: guard.reason } })}\n`)
} else if (process.env.HARNESS_ACTIVE !== "1") {
  // Codex already requested a repair once. Avoid an unbounded Stop cycle;
  // manual verification remains required and reports any outstanding failure.
  if (phase === "stop" && input.stop_hook_active) {
    process.stdout.write(`${JSON.stringify({ systemMessage: "Harness: automatic Stop retry already used. Report the manual verification result and any remaining failures." })}\n`)
  } else {
    try {
      const report = await verify(cwd, { phase, hook: true, deadline: Date.now() + (phase === "stop" ? 35_000 : 15_000) })
      const failures = report.runs.filter((run) => run.exitCode !== 0)
      const required = report.requiredFailures ?? []
      if (report.exitCode !== 0 && phase === "stop") {
        process.stdout.write(`${JSON.stringify({ decision: "block", reason: `Harness required checks need attention: ${required.length ? required.join(", ") : "invalid configuration (run harness doctor)"}. Repair or resolve the reported blocker, then run harness verify. Do not repeat checks without a change or new evidence.` })}\n`)
      } else if (failures.length || report.exitCode !== 0) {
        process.stdout.write(`${JSON.stringify({ systemMessage: `Harness ${phase}: ${failures.length ? failures.map((run) => `${run.capability} (${run.status})`).join(", ") : "invalid configuration"}. Run harness doctor or the affected capability; advisory findings do not block completion.` })}\n`)
      } else if (phase === "stop") process.stdout.write("{}\n")
    } catch {
      process.stdout.write(`${JSON.stringify({ systemMessage: `Harness ${phase} could not complete; run harness doctor. Verification has not passed.` })}\n`)
    }
  }
}
