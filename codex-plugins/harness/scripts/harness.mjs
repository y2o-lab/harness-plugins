#!/usr/bin/env node
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { adopt, analyzePromotion, detectRepository, doctor, formatReport, runCapability, verify } from "../core/harness-core.mjs"
import { modelGuidance } from "../core/model-guidance.mjs"

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const command = args[0] ?? "help"
const rootIndex = args.indexOf("--root")
const root = rootIndex >= 0 ? args[rootIndex + 1] : process.cwd()
const has = (flag) => args.includes(flag)

async function main() {
  let report
  switch (command) {
    case "guide": {
      const index = args.indexOf("--model")
      if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith("--"))) throw new Error("--model requires an explicit model ID")
      report = await modelGuidance(index >= 0 ? args[index + 1] : undefined)
      break
    }
    case "detect": report = await detectRepository(root); break
    case "doctor": report = await doctor(root); break
    case "adopt": report = await adopt(root, pluginRoot, has("--write")); break
    case "run": report = args[1] === "stop" ? await verify(root, { phase: "stop" }) : await runCapability(root, args[1], { phase: has("--phase") ? args[args.indexOf("--phase") + 1] : "manual" }); break
    case "verify": report = await verify(root, { phase: has("--phase") ? args[args.indexOf("--phase") + 1] : "stop" }); break
    case "promote":
      if (args[1] !== "analyze") throw new Error("Usage: harness promote analyze [--write]")
      report = await analyzePromotion(root, { write: has("--write") })
      break
    default:
      report = { usage: "harness <guide [--model ID]|detect|doctor|adopt|run|verify|promote analyze> [--root path]", notes: ["adopt is dry-run unless --write is supplied", "verify is hook-independent", "guide never changes the active model or effort"] }
  }
  process.stdout.write(formatReport(report))
  process.exitCode = report.exitCode ?? 0
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
})
