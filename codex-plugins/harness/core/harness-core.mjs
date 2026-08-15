import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { appendFile, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { spawn } from "node:child_process"

export const CAPABILITIES = ["lint", "format", "typecheck", "test", "build"]
const VALID_MODES = new Set(["off", "advisory", "required"])
const VALID_STRATEGIES = new Set(["changed", "affected", "all"])
const DEFAULT_QUALITY = Object.fromEntries(CAPABILITIES.map((name) => [name, { mode: "advisory", strategy: "all" }]))

const scriptNames = {
  lint: ["lint", "check:lint"],
  format: ["format:check", "format", "check:format"],
  typecheck: ["typecheck", "type-check", "check:types"],
  test: ["test", "test:unit"],
  build: ["build"]
}

const providerFiles = {
  eslint: ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc", ".eslintrc.json"],
  biome: ["biome.json", "biome.jsonc"],
  prettier: ["prettier.config.js", "prettier.config.mjs", ".prettierrc", ".prettierrc.json"],
  typescript: ["tsconfig.json"],
  vitest: ["vitest.config.ts", "vitest.config.js"],
  jest: ["jest.config.js", "jest.config.ts", "jest.config.cjs"]
}

export async function readJson(path) {
  try {
    return { value: JSON.parse(await readFile(path, "utf8")), error: null }
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) }
  }
}

export function normalizeRoot(value = process.cwd()) {
  return resolve(value)
}

export async function loadSettings(root) {
  const path = join(root, "harness-settings.json")
  if (!existsSync(path)) return { path, value: null, diagnostics: [] }
  const { value, error } = await readJson(path)
  if (error || !value || typeof value !== "object" || Array.isArray(value)) {
    return { path, value: null, diagnostics: [{ status: "error", code: "settings-invalid-json", message: error ?? "Settings must be an object." }] }
  }
  const diagnostics = []
  if (value.version !== 1) diagnostics.push({ status: "error", code: "settings-version", message: "Harness settings must declare version: 1." })
  for (const [capability, policy] of Object.entries(value.quality ?? {})) {
    if (!CAPABILITIES.includes(capability)) diagnostics.push({ status: "warning", code: "settings-unknown-capability", message: `Unknown capability: ${capability}.` })
    if (!policy || typeof policy !== "object") diagnostics.push({ status: "error", code: "settings-invalid-policy", message: `Policy for ${capability} must be an object.` })
    if (policy?.mode && !VALID_MODES.has(policy.mode)) diagnostics.push({ status: "error", code: "settings-invalid-mode", message: `${capability}.mode is invalid.` })
    if (policy?.strategy && !VALID_STRATEGIES.has(policy.strategy)) diagnostics.push({ status: "error", code: "settings-invalid-strategy", message: `${capability}.strategy is invalid.` })
  }
  for (const [guard, policy] of Object.entries(value.guards ?? {})) {
    if (!policy || typeof policy !== "object" || (policy.mode && !VALID_MODES.has(policy.mode))) diagnostics.push({ status: "error", code: "settings-invalid-guard", message: `Guard policy for ${guard} is invalid.` })
  }
  return { path, value, diagnostics }
}

function candidateProvider(capability, command, root) {
  const lower = command.toLowerCase()
  const names = Object.entries(providerFiles).filter(([, files]) => files.some((file) => existsSync(join(root, file)))).map(([name]) => name)
  const ordered = {
    lint: ["biome", "eslint"],
    format: ["biome", "prettier"],
    typecheck: ["typescript"],
    test: ["vitest", "jest"],
    build: []
  }[capability]
  return ordered.find((name) => lower.includes(name)) ?? ordered.find((name) => names.includes(name)) ?? "package-script"
}

export async function detectRepository(rootInput = process.cwd()) {
  const root = normalizeRoot(rootInput)
  const packagePath = join(root, "package.json")
  const packageResult = existsSync(packagePath) ? await readJson(packagePath) : { value: null, error: null }
  const scripts = packageResult.value?.scripts && typeof packageResult.value.scripts === "object" ? packageResult.value.scripts : {}
  const packageManager = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(root, "yarn.lock")) ? "yarn" : existsSync(join(root, "package-lock.json")) ? "npm" : packageResult.value ? "npm" : null
  const capabilities = {}
  for (const capability of CAPABILITIES) {
    const script = scriptNames[capability].find((name) => typeof scripts[name] === "string")
    const evidence = script ? [{ kind: "package-script", path: "package.json", detail: script }] : []
    if (!script) {
      const configNames = Object.entries(providerFiles).flatMap(([provider, files]) => files.filter((file) => existsSync(join(root, file))).map((file) => ({ provider, file })))
      for (const item of configNames) evidence.push({ kind: "config", path: item.file, detail: item.provider })
    }
    capabilities[capability] = script
      ? { status: "detected", command: `${packageManager ?? "npm"} run ${script}`, provider: candidateProvider(capability, scripts[script], root), confidence: 0.95, evidence }
      : { status: "not-applicable", command: null, provider: null, confidence: 0, evidence }
  }
  return {
    root,
    stack: packageResult.value ? ["nodejs", packageResult.value.types === "module" ? "esm" : "javascript"] : [],
    packageManager,
    diagnostics: packageResult.error ? [{ status: "error", code: "package-json-invalid", message: packageResult.error }] : [],
    capabilities
  }
}

export async function resolveCapabilities(rootInput = process.cwd()) {
  const root = normalizeRoot(rootInput)
  const [detection, settings] = await Promise.all([detectRepository(root), loadSettings(root)])
  const resolved = {}
  for (const capability of CAPABILITIES) {
    const detected = detection.capabilities[capability]
    const override = settings.value?.quality?.[capability] ?? {}
    const policy = { ...DEFAULT_QUALITY[capability], ...override }
    const command = override.command ?? detected.command
    const provider = override.provider ?? detected.provider
    resolved[capability] = {
      capability,
      mode: policy.mode,
      strategy: policy.strategy,
      command,
      provider,
      status: policy.mode === "off" ? "off" : command ? "ready" : "not-applicable",
      source: override.command || override.provider ? "settings" : detected.status === "detected" ? "repository" : "none",
      confidence: override.command ? 1 : detected.confidence,
      evidence: override.command ? [{ kind: "settings", path: "harness-settings.json", detail: "command override" }] : detected.evidence
    }
  }
  return { root, detection, settings, capabilities: resolved }
}

function runShell(command, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, HARNESS_ACTIVE: "1" }, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", (error) => resolveRun({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }))
    child.on("close", (exitCode) => resolveRun({ exitCode: exitCode ?? 1, stdout, stderr }))
  })
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

async function writeEvent(root, event) {
  const directory = join(root, ".harness")
  await mkdir(directory, { recursive: true })
  await appendFile(join(directory, "events.ndjson"), `${JSON.stringify(event)}\n`, "utf8")
}

async function changedFiles(root) {
  const result = await runShell("git diff --name-only HEAD", root)
  return result.exitCode === 0 ? result.stdout.split(/\r?\n/).map((file) => file.trim()).filter(Boolean) : []
}

export async function runCapability(rootInput, capability, options = {}) {
  const resolved = await resolveCapabilities(rootInput)
  const item = resolved.capabilities[capability]
  if (!item) return { status: "error", code: "unknown-capability", message: `Unsupported capability: ${capability}.`, exitCode: 2 }
  if (item.status === "off") return { status: "skipped", capability, message: "Disabled by policy.", exitCode: 0 }
  if (!item.command) return { status: "not-applicable", capability, message: "No existing command was detected; no command was guessed.", exitCode: 0 }
  const files = options.changedFiles ?? (item.strategy === "changed" ? await changedFiles(resolved.root) : [])
  const strategy = item.strategy === "all" ? { requested: "all", effective: "all" } : { requested: item.strategy, effective: "all", reason: "The selected repository script has no safe, provider-neutral partial-target interface; running it unchanged." }
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const result = await runShell(item.command, resolved.root)
  const event = {
    eventId: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    occurredAt: startedAt,
    sessionId: hash(process.env.HARNESS_SESSION_ID ?? "local-session").slice(0, 24),
    kind: result.exitCode === 0 ? "recovery" : "violation",
    capability,
    provider: item.provider,
    phase: options.phase ?? "manual",
    outcome: result.exitCode === 0 ? "passed" : "failed",
    durationMs: Date.now() - started,
    scope: { filesChanged: files.length },
    fingerprint: hash(`${capability}:${item.provider ?? "unknown"}:${result.exitCode === 0 ? "pass" : "failure"}`),
    privacy: "local-only"
  }
  try {
    await writeEvent(resolved.root, event)
  } catch (error) {
    return { status: "error", code: "event-store-write-failed", message: error instanceof Error ? error.message : String(error), result, exitCode: result.exitCode || 1 }
  }
  return { status: result.exitCode === 0 ? "passed" : "failed", capability, command: item.command, provider: item.provider, strategy, event, result, exitCode: result.exitCode }
}

export async function verify(rootInput, options = {}) {
  const resolved = await resolveCapabilities(rootInput)
  const phase = options.phase ?? "stop"
  const configured = resolved.settings.value?.lifecycle?.[phase]
  const fallback = phase === "postEdit" ? ["format"] : CAPABILITIES.filter((capability) => resolved.capabilities[capability].status === "ready")
  const capabilities = Array.isArray(configured) ? configured : fallback
  const runs = []
  for (const capability of capabilities) runs.push(await runCapability(resolved.root, capability, { phase }))
  const requiredFailure = runs.some((run) => run.status === "failed" && resolved.capabilities[run.capability]?.mode === "required")
  return { phase, runs, exitCode: requiredFailure ? 1 : 0 }
}

export async function doctor(rootInput) {
  const resolved = await resolveCapabilities(rootInput)
  const diagnostics = [...resolved.detection.diagnostics, ...resolved.settings.diagnostics]
  for (const item of Object.values(resolved.capabilities)) {
    if (item.status === "not-applicable" && item.mode === "required") diagnostics.push({ status: "error", code: "required-capability-unresolved", message: `${item.capability} is required but no command was found.` })
    if (item.status === "not-applicable" && item.mode !== "required") diagnostics.push({ status: "not-applicable", code: "capability-unresolved", message: `${item.capability} has no command.` })
  }
  const eventsPath = join(resolved.root, ".harness", "events.ndjson")
  if (existsSync(eventsPath)) {
    const events = (await readFile(eventsPath, "utf8")).split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
    const lastFailure = [...events].reverse().find((event) => event.kind === "violation" && event.outcome === "failed")
    diagnostics.push({ status: "pass", code: "event-store", message: "Local event store is the source of truth; it is never sent externally by this plugin." })
    if (lastFailure) diagnostics.push({ status: "error", code: "command-last-failed", message: `The most recent recorded ${lastFailure.capability} run failed during ${lastFailure.phase}.` })
  } else {
    diagnostics.push({ status: "warning", code: "event-store", message: "No local event store exists yet; run a capability to create one." })
  }
  diagnostics.push({ status: "warning", code: "hooks-best-effort", message: "Hook execution is optional; use `harness verify` for reproducible checks." })
  return { ...resolved, diagnostics }
}

export async function adopt(rootInput, pluginRoot, write = false) {
  const resolved = await resolveCapabilities(rootInput)
  const quality = {}
  for (const [capability, item] of Object.entries(resolved.capabilities)) {
    quality[capability] = { mode: item.command ? (capability === "lint" || capability === "format" ? "required" : "advisory") : "off", strategy: capability === "lint" || capability === "format" ? "changed" : "affected" }
  }
  const proposal = {
    $schema: "./.harness/schema/harness-settings.schema.json",
    version: 1,
    quality,
    lifecycle: { postEdit: ["format"], stop: ["lint", "format", "typecheck"] },
    guards: { dangerousCommands: { mode: "required" }, protectedFiles: { mode: "required" }, secrets: { mode: "required" } },
    promotion: { mode: "advisory", issueMode: "manual", repositoryThreshold: 0.7, pluginThreshold: 0.8 }
  }
  if (!write) return { written: false, proposal, message: "Dry run only. Re-run with --write after reviewing the proposal." }
  const settingsPath = join(resolved.root, "harness-settings.json")
  if (existsSync(settingsPath)) return { written: false, proposal, message: "harness-settings.json already exists; refusing to overwrite it." }
  await writeFile(settingsPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8")
  await mkdir(join(resolved.root, ".harness", "schema"), { recursive: true })
  await cp(join(pluginRoot, "schemas", "harness-settings.schema.json"), join(resolved.root, ".harness", "schema", "harness-settings.schema.json"))
  const gitignorePath = join(resolved.root, ".gitignore")
  const ignored = existsSync(gitignorePath) ? await readFile(gitignorePath, "utf8") : ""
  if (!ignored.split(/\r?\n/).includes(".harness/")) await appendFile(gitignorePath, `${ignored && !ignored.endsWith("\n") ? "\n" : ""}.harness/\n`, "utf8")
  return { written: true, proposal, paths: [settingsPath, join(resolved.root, ".harness", "schema", "harness-settings.schema.json"), gitignorePath] }
}

export function evaluateDangerousCommand(command, settings = null) {
  const mode = settings?.guards?.dangerousCommands?.mode ?? "required"
  if (mode === "off" || typeof command !== "string") return { decision: "allow" }
  const patterns = [
    { expression: /\brm\s+(?:-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*|-rf|-fr)\s+(?:\/|~)(?:\s|$)/, reason: "Refusing a recursive deletion rooted at / or the home directory." },
    { expression: /\b(?:git\s+reset\s+--hard|git\s+clean\s+-[A-Za-z]*f)/, reason: "Refusing a destructive Git command through the automated hook." },
    { expression: /\b(?:mkfs|dd)\b/, reason: "Refusing a disk-destructive command through the automated hook." }
  ]
  const match = patterns.find((item) => item.expression.test(command))
  return match ? { decision: "deny", reason: match.reason } : { decision: "allow" }
}

export function evaluateToolGuard(command, settings = null) {
  const dangerous = evaluateDangerousCommand(command, settings)
  if (dangerous.decision === "deny") return dangerous
  if (typeof command !== "string") return { decision: "allow" }
  const secretsMode = settings?.guards?.secrets?.mode ?? "required"
  if (secretsMode !== "off" && /(?:\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9_-]{20,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(command)) {
    return { decision: "deny", reason: "Refusing a tool input containing a likely secret; use an ignored local environment file or approved secret manager." }
  }
  const protectedMode = settings?.guards?.protectedFiles?.mode ?? "required"
  if (protectedMode !== "off" && /\*\*\*\s+(?:Add|Update|Delete) File:\s+(?:\.env(?!\.example\b)(?:\.[^\s]+)?|appsettings(?:\.[^\s]+)?\.json)\b/.test(command)) {
    return { decision: "deny", reason: "Refusing an automated edit to a protected environment configuration file." }
  }
  return { decision: "allow" }
}

export async function analyzePromotion(rootInput, options = {}) {
  const root = normalizeRoot(rootInput)
  const eventPath = join(root, ".harness", "events.ndjson")
  if (!existsSync(eventPath)) return { candidates: [], markdown: "# Harness Health\n\nNo local events have been recorded.\n" }
  const lines = (await readFile(eventPath, "utf8")).split(/\r?\n/).filter(Boolean)
  const events = lines.flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }).filter((event) => event?.privacy === "local-only")
  const groups = new Map()
  for (const event of events.filter((event) => event.kind === "violation")) {
    const group = groups.get(event.fingerprint) ?? { events: [], capability: event.capability, provider: event.provider, fingerprint: event.fingerprint }
    group.events.push(event)
    groups.set(event.fingerprint, group)
  }
  const candidates = [...groups.values()].map((group) => {
    const sessions = new Set(group.events.map((event) => event.sessionId)).size
    const days = new Set(group.events.map((event) => String(event.occurredAt).slice(0, 10))).size
    const recurrence = Math.min(1, group.events.length / 3)
    const successfulRecoveries = events.filter((event) => event.kind === "recovery" && event.outcome === "passed" && event.capability === group.capability && event.provider === group.provider).length
    const confidence = group.provider && group.provider !== "unknown" ? 0.95 : 0.6
    const impact = group.capability === "lint" || group.capability === "typecheck" ? 0.95 : 0.7
    const fixability = successfulRecoveries > 0 ? 0.95 : 0.9
    const distribution = Math.min(1, sessions / 3)
    const score = Number((recurrence * confidence * impact * fixability * distribution).toFixed(3))
    const level = score >= 0.7 && sessions >= 3 ? "L2 repository proposal" : score >= 0.4 ? "L1 advisory" : "L0 observe"
    const promotionId = `quality:${group.capability}:prevent-repeat:v1`
    const proposal = level === "L2 repository proposal" ? {
      promotionId,
      classification: "repository",
      evidence: { occurrences: group.events.length, distinctSessions: sessions, days, repositories: 1, successfulRecoveries },
      proposedTarget: group.capability === "format" ? "repository lifecycle postEdit" : "repository quality policy",
      suggestedChange: `Review whether ${group.capability} should be made more discoverable or automated through the existing Harness capability.`,
      estimatedCost: "Measure with representative runs before enforcing.",
      risk: "A broader gate may slow feedback or amplify flaky checks.",
      rollback: "Set the affected capability mode to advisory or off in harness-settings.json after review."
    } : null
    return { ...group, occurrences: group.events.length, sessions, days, successfulRecoveries, score, level, promotionId, proposal }
  }).sort((a, b) => b.score - a.score)
  const proposals = candidates.flatMap((candidate) => candidate.proposal ? [candidate.proposal] : [])
  const markdown = ["# Harness Health", "", `Last analyzed: ${new Date().toISOString()}`, "", "| Pattern | Occurrences | Sessions | Days | Recoveries | Score | Status |", "|---|---:|---:|---:|---:|---:|---|", ...candidates.map((item) => `| ${item.capability} (${item.provider ?? "unknown"}) | ${item.occurrences} | ${item.sessions} | ${item.days} | ${item.successfulRecoveries} | ${item.score} | ${item.level} |`), "", "## Promotion proposals", "", ...proposals.flatMap((proposal) => [`### ${proposal.promotionId}`, "", `- Evidence: ${proposal.evidence.occurrences} occurrences / ${proposal.evidence.distinctSessions} sessions / ${proposal.evidence.days} days`, `- Successful recoveries: ${proposal.evidence.successfulRecoveries}`, `- Target: ${proposal.proposedTarget}`, `- Change: ${proposal.suggestedChange}`, `- Cost: ${proposal.estimatedCost}`, `- Risk: ${proposal.risk}`, `- Rollback: ${proposal.rollback}`, ""]), proposals.length === 0 ? "No candidate met the repository-proposal threshold." : "", "", "Proposals are local and advisory. This MVP does not create or update GitHub issues.", ""].join("\n")
  if (options.write) {
    await mkdir(join(root, ".harness"), { recursive: true })
    await writeFile(join(root, ".harness", "dashboard.md"), markdown, "utf8")
  }
  return { candidates, proposals, markdown, written: Boolean(options.write) }
}

export function formatReport(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function pluginNameFromRoot(root) {
  return basename(root)
}
