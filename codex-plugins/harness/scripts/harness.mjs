#!/usr/bin/env node
import { dirname, resolve } from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"
import { adopt, analyzePromotion, detectRepository, doctor, formatReport, planVerification, runCapability, verify } from "../core/harness-core.mjs"
import { modelGuidance } from "../core/model-guidance.mjs"

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const usage = "harness <guide [--model ID]|detect|doctor|adopt [--write]|plan [--hook]|run CHECK|verify|promote analyze> [--root PATH] [--phase PHASE] [--summary]"

function summarizeRun(run) {
  const { capability, mode, status, code, blockedBy, exitCode, result, message, diagnostics, prerequisites } = run
  return {
    capability, mode, status, code, blockedBy, exitCode, message, diagnostics,
    durationMs: run.event?.durationMs,
    timedOut: result?.timedOut || undefined,
    outputTruncated: result?.outputTruncated || undefined,
    stdout: exitCode && result?.stdout ? result.stdout : undefined,
    stderr: exitCode && result?.stderr ? result.stderr : undefined,
    prerequisites: prerequisites?.map(summarizeRun)
  }
}

async function main() {
  const { values, positionals: [command = "help", target, ...rest] } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" }, phase: { type: "string" }, model: { type: "string" },
      write: { type: "boolean" }, summary: { type: "boolean" }, hook: { type: "boolean" }, help: { type: "boolean", short: "h" }
    }
  })
  if (values.help || command === "help") return { usage }
  if (rest.length || (target !== undefined && !["run", "promote"].includes(command))) throw new Error(usage)
  const root = values.root ?? process.cwd()
  const phase = values.phase
  let report
  switch (command) {
    case "guide": return modelGuidance(values.model)
    case "detect": return detectRepository(root)
    case "doctor": return doctor(root)
    case "adopt": return adopt(root, pluginRoot, values.write)
    case "plan": return planVerification(root, { phase, hook: values.hook })
    case "run":
      if (target !== "stop") {
        report = await runCapability(root, target, { phase: phase ?? "manual" })
        return values.summary ? summarizeRun(report) : report
      }
      report = await verify(root, { phase: "stop" })
      break
    case "verify": report = await verify(root, { phase }); break
    case "promote":
      if (target !== "analyze") throw new Error(usage)
      return analyzePromotion(root, { write: values.write })
    default: throw new Error(usage)
  }
  return values.summary ? { ...report, runs: report.runs.map(summarizeRun) } : report
}

main().then((report) => {
  process.stdout.write(formatReport(report))
  process.exitCode = report.exitCode ?? 0
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
})
