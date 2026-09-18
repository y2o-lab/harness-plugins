import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { detectRepository, doctor, runCapability, verify } from "../core/harness-core.mjs"
import { modelGuidance } from "../core/model-guidance.mjs"
import { runShell } from "../core/process-runner.mjs"

async function fixture(settings, script = "process.exit(0)") {
  const root = await mkdtemp(join(tmpdir(), "harness-execution-"))
  await writeFile(join(root, "check.mjs"), script)
  await writeFile(join(root, "harness-settings.json"), JSON.stringify({ version: 1, ...settings }))
  return root
}

function runNode(relative, args = [], input = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(relative, import.meta.url)), ...args], { env: { ...process.env, HARNESS_ACTIVE: "0" }, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (data) => { stdout += data })
    child.stderr.on("data", (data) => { stderr += data })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(JSON.stringify(input))
  })
}

test("advisory failure does not block Stop; required failure requests one continuation", async () => {
  for (const mode of ["advisory", "required"]) {
    const root = await fixture({ quality: { lint: { mode, command: "node check.mjs" } }, lifecycle: { stop: ["lint"] } }, "process.exit(1)")
    const first = await runNode("../scripts/hook-adapter.mjs", ["stop"], { cwd: root })
    assert.equal(first.code, 0)
    const report = JSON.parse(first.stdout)
    assert.equal(report.decision, mode === "required" ? "block" : undefined)
    assert.equal(report.continue, undefined)
    const before = await readFile(join(root, ".harness/events.ndjson"), "utf8")
    const repeated = await runNode("../scripts/hook-adapter.mjs", ["stop"], { cwd: root, stop_hook_active: true })
    assert.equal(JSON.parse(repeated.stdout).decision, undefined)
    assert.equal(await readFile(join(root, ".harness/events.ndjson"), "utf8"), before)
  }
})

test("required checks cannot be omitted by lifecycle; unavailable checks fail verification", async () => {
  const root = await fixture({ quality: { test: { mode: "required" } }, lifecycle: { stop: [] } })
  const report = await verify(root)
  assert.equal(report.exitCode, 1)
  assert.deepEqual(report.requiredFailures, ["test"])
  assert.equal(report.runs[0].code, "capability-unresolved")
})

test("invalid configuration fails without executing commands", async () => {
  for (const invalid of [
    { quality: { lint: { mode: "" } } },
    { quality: { lint: { command: 12 } } },
    { lifecycle: { stop: ["typo"] } },
    { execution: { timeoutMs: -1 } },
    { execution: [] }
  ]) {
    const root = await fixture(invalid)
    const report = await verify(root)
    assert.equal(report.exitCode, 2)
    assert.deepEqual(report.runs, [])
    assert.equal((await runCapability(root, "lint")).code, "configuration-invalid")
    const hooked = await runNode("../scripts/hook-adapter.mjs", ["stop"], { cwd: root })
    assert.equal(JSON.parse(hooked.stdout).decision, "block")
  }
})

test("postEdit is opt-in and lifecycle entries are deduplicated", async () => {
  const root = await fixture({ quality: { format: { mode: "required", command: "node check.mjs" } } })
  assert.deepEqual((await verify(root, { phase: "postEdit" })).runs, [])
  await writeFile(join(root, "harness-settings.json"), JSON.stringify({ version: 1, quality: { format: { mode: "required", command: "node check.mjs" } }, lifecycle: { postEdit: ["format", "format"] } }))
  assert.equal((await verify(root, { phase: "postEdit" })).runs.length, 1)
})

test("plain format scripts are not implicitly executed as validation", async () => {
  const root = await fixture({})
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "module", scripts: { format: "prettier --write ." } }))
  const report = await detectRepository(root)
  assert.equal(report.capabilities.format.command, null)
  assert.equal(report.diagnostics[0].code, "format-check-unresolved")
  assert.ok(report.stack.includes("esm"))
})

test("existing custom lifecycle phases and explicit commands remain usable", async () => {
  const root = await fixture({ quality: { format: { command: "node check.mjs" } }, lifecycle: { review: ["format"] } })
  const report = await verify(root, { phase: "review" })
  assert.equal(report.exitCode, 0)
  assert.equal(report.runs[0].status, "passed")
  assert.equal(report.runs[0].command, "node check.mjs")
})

test("timeouts fail required checks and output is bounded with a visible truncation flag", async () => {
  const root = await fixture({ quality: { test: { mode: "required", command: "node check.mjs" } }, execution: { timeoutMs: 200 } }, "setInterval(() => {}, 1000)")
  const report = await verify(root)
  assert.equal(report.exitCode, 1)
  assert.equal(report.runs[0].result.timedOut, true)
  assert.equal(report.runs[0].result.exitCode, 124)
  await writeFile(join(root, "check.mjs"), "console.log('x'.repeat(50000)); console.error('failure-tail'); process.exit(1)")
  const bounded = await runShell("node check.mjs", root, { maxOutputBytes: 128, timeoutMs: 2000 })
  assert.ok(Buffer.byteLength(bounded.stdout) <= 128)
  assert.equal(bounded.outputTruncated, true)
  assert.match(bounded.stderr, /failure-tail/)
  assert.equal(bounded.exitCode, 1)
})

test("expired hook budget reports incomplete required checks without running them", async () => {
  const root = await fixture({ quality: { lint: { mode: "required", command: "node check.mjs" } } })
  const report = await verify(root, { deadline: Date.now() - 1 })
  assert.equal(report.exitCode, 1)
  assert.equal(report.runs[0].code, "verification-budget-exhausted")
})

test("event-store errors retain capability identity and fail required verification", async () => {
  const root = await fixture({ quality: { lint: { mode: "required", command: "node check.mjs" } } })
  await writeFile(join(root, ".harness"), "not a directory")
  const report = await verify(root)
  assert.equal(report.exitCode, 1)
  assert.equal(report.runs[0].capability, "lint")
  assert.equal(report.runs[0].code, "event-store-write-failed")
})

test("doctor clears a recovered failure", async () => {
  const root = await fixture({ quality: { lint: { command: "node check.mjs" } } }, "process.exit(1)")
  await runCapability(root, "lint")
  assert.ok((await doctor(root)).diagnostics.some((item) => item.code === "command-last-failed"))
  await writeFile(join(root, "check.mjs"), "process.exit(0)")
  await runCapability(root, "lint")
  assert.equal((await doctor(root)).diagnostics.some((item) => item.code === "command-last-failed"), false)
})

test("guidance preserves each explicit model, stays advisory, and rejects unknown models", async () => {
  for (const model of ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    const result = await runNode("../scripts/harness.mjs", ["guide", "--model", model])
    assert.equal(result.code, 0)
    const guide = JSON.parse(result.stdout)
    assert.equal(guide.model, model)
    assert.equal(guide.changesModel, false)
    assert.equal(guide.advisory, true)
    assert.ok(guide.common.length > 0 && guide.specific.length > 0)
  }
  assert.equal((await modelGuidance()).specific, null)
  assert.equal((await modelGuidance("../../other")).exitCode, 2)
  assert.equal((await runNode("../scripts/harness.mjs", ["guide", "--model"])).code, 2)
})
