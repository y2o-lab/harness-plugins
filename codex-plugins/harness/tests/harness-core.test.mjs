import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { adopt, analyzePromotion, detectRepository, doctor, evaluateDangerousCommand, evaluateToolGuard, resolveCapabilities, runCapability, verify } from "../core/harness-core.mjs"

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function runNode(script, args, input = "") {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => resolveRun({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "harness-plugin-"))
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "module", scripts: { lint: "node lint.mjs", "format:check": "node format.mjs", typecheck: "node types.mjs", test: "node test.mjs", build: "node build.mjs" } }, null, 2))
  for (const name of ["lint", "format", "types", "test", "build"]) await writeFile(join(root, `${name}.mjs`), "process.exit(0)\n")
  return root
}

test("detects package scripts with evidence and confidence", async () => {
  const root = await fixture()
  const detection = await detectRepository(root)
  assert.equal(detection.packageManager, "pnpm")
  assert.equal(detection.capabilities.lint.command, "pnpm run lint")
  assert.equal(detection.capabilities.lint.confidence, 0.95)
  assert.equal(detection.capabilities.lint.evidence[0].path, "package.json")
})

test("settings command override takes precedence", async () => {
  const root = await fixture()
  await writeFile(join(root, "harness-settings.json"), JSON.stringify({ version: 1, quality: { lint: { mode: "required", strategy: "all", command: "node custom-lint.mjs", provider: "custom" } } }))
  const resolved = await resolveCapabilities(root)
  assert.equal(resolved.capabilities.lint.command, "node custom-lint.mjs")
  assert.equal(resolved.capabilities.lint.source, "settings")
})

test("run records privacy-minimized local events and verify is CLI-based", async () => {
  const root = await fixture()
  await writeFile(join(root, "harness-settings.json"), JSON.stringify({ version: 1, quality: { lint: { mode: "required", strategy: "all", command: "node lint.mjs" } }, lifecycle: { stop: ["lint"] } }))
  const run = await runCapability(root, "lint", { phase: "stop" })
  assert.equal(run.status, "passed", JSON.stringify(run.result))
  const stored = JSON.parse((await readFile(join(root, ".harness", "events.ndjson"), "utf8")).trim())
  assert.equal(stored.privacy, "local-only")
  assert.equal("command" in stored, false)
  const verified = await verify(root, { phase: "stop" })
  assert.equal(verified.exitCode, 0)
})

test("doctor distinguishes unresolved required capability", async () => {
  const root = await fixture()
  await writeFile(join(root, "harness-settings.json"), JSON.stringify({ version: 1, quality: { build: { mode: "required", strategy: "all", command: "" } } }))
  const report = await doctor(root)
  assert.ok(report.diagnostics.some((item) => item.code === "required-capability-unresolved"))
})

test("doctor reports a recorded command failure separately from configuration", async () => {
  const root = await fixture()
  await writeFile(join(root, "lint.mjs"), "process.exit(1)\n")
  await runCapability(root, "lint", { phase: "manual" })
  const report = await doctor(root)
  assert.ok(report.diagnostics.some((item) => item.code === "command-last-failed"))
})

test("promotion uses sessions and days rather than raw count alone", async () => {
  const root = await fixture()
  await mkdir(join(root, ".harness"), { recursive: true })
  const events = ["a", "b", "c"].map((session, index) => JSON.stringify({ kind: "violation", privacy: "local-only", capability: "lint", provider: "eslint", fingerprint: "sha256:lint", sessionId: session, occurredAt: `2026-08-0${index + 1}T00:00:00.000Z` })).concat(JSON.stringify({ kind: "recovery", outcome: "passed", privacy: "local-only", capability: "lint", provider: "eslint" })).join("\n")
  await writeFile(join(root, ".harness", "events.ndjson"), `${events}\n`)
  const report = await analyzePromotion(root)
  assert.equal(report.candidates[0].sessions, 3)
  assert.equal(report.candidates[0].days, 3)
  assert.equal(report.candidates[0].successfulRecoveries, 1)
  assert.equal(report.proposals[0].promotionId, "quality:lint:prevent-repeat:v1")
})

test("dangerous-command guard only denies high-confidence destructive patterns", () => {
  assert.equal(evaluateDangerousCommand("rm -rf /tmp/work").decision, "allow")
  assert.equal(evaluateDangerousCommand("rm -rf / ").decision, "deny")
  assert.equal(evaluateDangerousCommand("git reset --hard").decision, "deny")
})

test("tool guard protects likely secrets and environment files", () => {
  assert.equal(evaluateToolGuard("echo sk-abcdefghijklmnopqrstuvwx").decision, "deny")
  assert.equal(evaluateToolGuard("*** Add File: .env\n+KEY=value").decision, "deny")
  assert.equal(evaluateToolGuard("*** Add File: .env.example\n+KEY=").decision, "allow")
  assert.equal(evaluateToolGuard("*** Add File: src/main.ts").decision, "allow")
})

test("adopt is dry-run first and never overwrites existing settings", async () => {
  const root = await fixture()
  const preview = await adopt(root, pluginRoot, false)
  assert.equal(preview.written, false)
  const created = await adopt(root, pluginRoot, true)
  assert.equal(created.written, true)
  const repeated = await adopt(root, pluginRoot, true)
  assert.equal(repeated.written, false)
  assert.match(await readFile(join(root, ".gitignore"), "utf8"), /\.harness\//)
})

test("hook adapter consumes Codex hook JSON and delegates without provider commands", async () => {
  const root = await fixture()
  const adapter = join(pluginRoot, "scripts", "hook-adapter.mjs")
  const pre = await runNode(adapter, ["preCommand"], JSON.stringify({ cwd: root, tool_input: { command: "git reset --hard" } }))
  assert.equal(pre.code, 0)
  assert.equal(JSON.parse(pre.stdout).hookSpecificOutput.permissionDecision, "deny")
  const post = await runNode(adapter, ["postEdit"], JSON.stringify({ cwd: root }))
  assert.equal(post.code, 0)
  assert.equal(post.stderr, "")
})

test("CLI supports evidence-based detection and the stop alias", async () => {
  const root = await fixture()
  const cli = join(pluginRoot, "scripts", "harness.mjs")
  const detected = await runNode(cli, ["detect", "--root", root])
  assert.equal(JSON.parse(detected.stdout).capabilities.lint.status, "detected")
  const stopped = await runNode(cli, ["run", "stop", "--root", root])
  assert.equal(stopped.code, 0)
  assert.equal(JSON.parse(stopped.stdout).phase, "stop")
})
