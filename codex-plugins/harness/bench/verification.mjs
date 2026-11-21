// Local, reproducible CLI overhead/latency probe. No network or model calls.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

const cli = fileURLToPath(new URL("../scripts/harness.mjs", import.meta.url))
const root = await mkdtemp(join(tmpdir(), "harness-benchmark-"))
const names = ["lint", "format", "typecheck", "test", "build"]
const quality = Object.fromEntries(names.map((name) => [name, {
  command: "node check.mjs", mode: "required", dependsOn: name === "build" ? ["test", "typecheck"] : []
}]))
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

async function sample(maxParallel, summary) {
  await writeFile(join(root, "harness-settings.json"), JSON.stringify({ version: 1, quality, execution: { maxParallel } }))
  const args = [cli, "verify", "--root", root]
  if (summary) args.push("--summary")
  const started = performance.now()
  const output = execFileSync(process.execPath, args)
  const elapsedMs = Math.round(performance.now() - started)
  const report = JSON.parse(output)
  assert.equal(report.metrics.executed, names.length)
  assert.deepEqual(report.runs.map((r) => [r.capability, r.status]), names.map((name) => [name, "passed"]))
  return { elapsedMs, reportBytes: output.byteLength }
}

try {
  await writeFile(join(root, "check.mjs"), 'setTimeout(() => console.log("x".repeat(1024)), 100)\n')
  const serial = [], parallel = [], full = [], compact = []
  for (let round = 0; round < 5; round++) {
    for (const limit of round % 2 ? [2, 1] : [1, 2]) {
      const sampleResult = await sample(limit, true)
      const times = limit === 1 ? serial : parallel
      times.push(sampleResult.elapsedMs)
      compact.push(sampleResult.reportBytes)
    }
    full.push((await sample(1, false)).reportBytes)
  }
  console.log(JSON.stringify({
    checks: names.length, rounds: 5, delayPerCheckMs: 100, stdoutPerCheckBytes: 1025,
    medianElapsedMs: { serial: median(serial), parallel2: median(parallel) },
    medianReportBytes: { full: median(full), summary: median(compact) }
  }, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
