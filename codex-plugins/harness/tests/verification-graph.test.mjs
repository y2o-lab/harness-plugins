import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { doctor, planVerification, runCapability, verify } from "../core/harness-core.mjs"
import { executePlan } from "../core/verification-graph.mjs"

const cli = fileURLToPath(new URL("../scripts/harness.mjs", import.meta.url))
const adapter = fileURLToPath(new URL("../scripts/hook-adapter.mjs", import.meta.url))
const check = (name, dependsOn = [], mode = "advisory") => ({ command: `node probe.mjs ${name}`, mode, dependsOn })

async function fixture(t, settings) {
  const root = await mkdtemp(join(tmpdir(), "harness-dag-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, "harness-settings.json"), JSON.stringify({ version: 1, ...settings }))
  await writeFile(join(root, "probe.mjs"), [
    'import { appendFileSync } from "node:fs"',
    'const name = process.argv[2]',
    'appendFileSync("trace", name + "\\n")',
    'console.log("check-output-" + name)',
    'if (name === "fail") process.exit(1)'
  ].join("\n"))
  return root
}

test("plan, targeted run and stop share dependencies and run a common prerequisite once", async (t) => {
  const root = await fixture(t, {
    quality: { prepare: check("prepare"), lint: check("lint", ["prepare"]), test: check("test", ["prepare"]), build: check("build", ["lint", "test", "lint"], "required") },
    lifecycle: { stop: [], postEdit: [] }
  })
  const plan = JSON.parse(execFileSync(process.execPath, [cli, "plan", "--root", root], { encoding: "utf8" }))
  assert.deepEqual(plan.nodes.map((item) => item.capability), ["prepare", "lint", "test", "build"])
  assert.equal(existsSync(join(root, ".harness")), false)
  assert.equal((await verify(root, { phase: "postEdit" })).status, "no-checks")
  assert.equal(existsSync(join(root, "trace")), false)
  const run = await runCapability(root, "build")
  assert.equal(run.status, "passed")
  assert.deepEqual(run.prerequisites.map((item) => item.status), ["passed", "passed", "passed"])
  assert.equal(await readFile(join(root, "trace"), "utf8"), "prepare\nlint\ntest\nbuild\n")
  const report = JSON.parse(execFileSync(process.execPath, [cli, "verify", "--summary", "--root", root], { encoding: "utf8" }))
  assert.equal(report.metrics.executed, 4)
  assert.equal(report.status, "passed")
  assert.ok(report.runs.every((item) => item.status === "passed" && item.stdout === undefined && item.event === undefined))
})

test("failed, off and unavailable prerequisites block descendants while independent checks finish", async (t) => {
  for (const source of [check("fail"), check("off", [], "off"), {}]) {
    const root = await fixture(t, {
      quality: { lint: source, test: check("test", ["lint"]), build: check("build", ["test"], "required"), docs: check("docs") },
      lifecycle: { stop: ["docs"] }, execution: { maxParallel: 2 }
    })
    const report = await verify(root)
    assert.equal(report.exitCode, 1)
    assert.deepEqual(report.requiredFailures, ["build"])
    assert.equal(report.metrics.blocked, 2)
    assert.equal(report.runs.find((r) => r.capability === "docs").status, "passed")
    assert.deepEqual(report.runs.find((r) => r.capability === "test").blockedBy, ["lint"])
    assert.deepEqual(report.runs.find((r) => r.capability === "build").blockedBy, ["test"])
    assert.doesNotMatch(await readFile(join(root, "trace"), "utf8"), /build|test|off/)
    const hook = JSON.parse(execFileSync(process.execPath, [adapter, "stop"], { env: { ...process.env, HARNESS_ACTIVE: "0" }, input: JSON.stringify({ cwd: root, session_id: "fixture-session" }), encoding: "utf8" }))
    assert.equal(hook.decision, "block")
    const result = spawnSync(process.execPath, [cli, "run", "build", "--summary", "--root", root], { encoding: "utf8" })
    assert.equal(result.status, 1)
    const summary = JSON.parse(result.stdout)
    assert.deepEqual(summary.blockedBy, ["test"])
    if (source.command && source.mode !== "off") assert.match(summary.prerequisites[0].stdout, /check-output-fail/)
  }
})

test("invalid graphs fail planning, diagnosis and execution before any command runs", async (t) => {
  const base = check("lint")
  for (const [quality, execution, code] of [
    [{ lint: { ...base, dependsOn: "build" } }, {}, "settings-invalid-dependency"],
    [{ lint: { ...base, dependsOn: ["missing"] } }, {}, "settings-invalid-dependency"],
    [{ lint: base, test: check("test", ["build"]), build: check("build", ["test"]) }, {}, "settings-dependency-cycle"],
    [{ lint: check("lint", ["lint"]) }, {}, "settings-dependency-cycle"],
    [{ stop: base }, {}, "settings-invalid-capability"],
    [{ typo: { mode: "required" } }, {}, "settings-invalid-capability"],
    [{ lint: base }, { maxParallel: 0 }, "settings-invalid-execution"],
    [{ lint: base }, { maxParallel: 9 }, "settings-invalid-execution"]
  ]) {
    const root = await fixture(t, { quality, execution, lifecycle: { stop: ["lint"] } })
    assert.ok((await doctor(root)).diagnostics.some((d) => d.code === code))
    assert.equal((await planVerification(root)).exitCode, 2)
    assert.equal((await verify(root)).exitCode, 2)
    assert.equal((await runCapability(root, "lint")).exitCode, 2)
    assert.equal(existsSync(join(root, "trace")), false)
  }
})

test("scheduler honors the parallel limit and releases dependents before a slow sibling finishes", async () => {
  const nodes = [["slow", []], ["fast", []], ["after", ["fast"]], ["last", ["slow", "after"]]].map(([capability, dependsOn]) => ({ capability, dependsOn, mode: "required" }))
  const starts = []
  const resolvers = new Map()
  const execute = (capability) => new Promise((resolve) => {
    starts.push(capability)
    resolvers.set(capability, () => resolve({ capability, status: "passed", exitCode: 0 }))
  })
  const report = executePlan({ nodes, maxParallel: 2 }, execute)
  assert.deepEqual(starts, ["slow", "fast"])
  resolvers.get("fast")()
  await new Promise(setImmediate)
  assert.deepEqual(starts, ["slow", "fast", "after"])
  resolvers.get("after")()
  await new Promise(setImmediate)
  assert.equal(starts.includes("last"), false)
  resolvers.get("slow")()
  await new Promise(setImmediate)
  resolvers.get("last")()
  assert.deepEqual((await report).map((run) => run.capability), ["slow", "fast", "after", "last"])
})

test("Stop identifies a disabled root cause, limits continuation and preserves a hashed session", async (t) => {
  const root = await fixture(t, {
    quality: { lint: check("lint", [], "off"), test: check("test", ["lint"], "required"), docs: check("docs") },
    lifecycle: { stop: ["docs"] }
  })
  const input = { cwd: root, session_id: "private-session-from-host" }
  const stop = (event) => JSON.parse(execFileSync(process.execPath, [adapter, "stop"], { env: { ...process.env, HARNESS_ACTIVE: "0" }, encoding: "utf8", input: JSON.stringify(event) }))
  const first = stop(input)
  assert.equal(first.decision, "block")
  assert.match(first.reason, /lint \(skipped\)/)
  assert.equal(stop({ ...input, stop_hook_active: true }).decision, undefined)
  const events = await readFile(join(root, ".harness/events.ndjson"), "utf8")
  assert.equal(events.trim().split("\n").length, 1)
  assert.equal(events.includes(input.session_id), false)
  assert.match(JSON.parse(events).sessionId, /^sha256:/)
})

test("unknown phases and misspelled dependency fields cannot silently launch commands", async (t) => {
  const root = await fixture(t, { quality: { lint: check("lint") } })
  assert.equal((await verify(root, { phase: "stpo" })).exitCode, 2)
  await writeFile(join(root, "harness-settings.json"), JSON.stringify({ version: 1, quality: { lint: { ...check("lint"), dependOn: ["test"] } } }))
  assert.equal((await verify(root)).exitCode, 2)
  assert.equal(existsSync(join(root, "trace")), false)
})
