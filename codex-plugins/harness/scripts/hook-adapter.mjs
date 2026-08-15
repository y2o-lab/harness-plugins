#!/usr/bin/env node
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { evaluateToolGuard } from "../core/harness-core.mjs"

const phase = process.argv[2]
const cli = resolve(dirname(fileURLToPath(import.meta.url)), "harness.mjs")
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
} else {
  const child = spawn(process.execPath, [cli, "verify", "--root", cwd, "--phase", phase], { stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout.on("data", (chunk) => { output += chunk })
  child.on("close", (code) => {
    let report = null
    try { report = JSON.parse(output) } catch {}
    const failures = report?.runs?.filter((run) => run.status === "failed") ?? []
    if (failures.length > 0) {
      const message = `Harness ${phase}: ${failures.length} quality check(s) failed. Run harness verify to inspect and repair.`
      const response = phase === "stop" ? { continue: false, stopReason: message, systemMessage: message } : { systemMessage: message }
      process.stdout.write(`${JSON.stringify(response)}\n`)
    } else if ((code ?? 1) !== 0) {
      process.stdout.write(`${JSON.stringify({ systemMessage: `Harness ${phase} could not complete; run harness doctor.` })}\n`)
    }
  })
}
