import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { appendFile, cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { runShell } from "./process-runner.mjs"
import { buildPlan, executePlan, orderChecks } from "./verification-graph.mjs"

export const CAPABILITIES = ["lint", "format", "typecheck", "test", "build"]
const VALID_MODES = new Set(["off", "advisory", "required"])
const VALID_STRATEGIES = new Set(["changed", "affected", "all"])
const DEFAULT_POLICY = { mode: "advisory", strategy: "all" }

const scriptNames = {
  lint: ["lint", "check:lint"],
  format: ["format:check", "check:format"],
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
  const object = (item) => item !== null && typeof item === "object" && !Array.isArray(item)
  if (value.version !== 1) diagnostics.push({ status: "error", code: "settings-version", message: "Harness settings must declare version: 1." })
  for (const section of ["quality", "lifecycle", "guards", "execution", "promotion"]) {
    if (value[section] !== undefined && !object(value[section])) diagnostics.push({ status: "error", code: "settings-invalid-section", message: `${section} must be an object.` })
  }
  const known = new Set([...CAPABILITIES, ...Object.keys(value.quality ?? {})])
  for (const [capability, policy] of Object.entries(value.quality ?? {})) {
    if (!CAPABILITIES.includes(capability) && (!/^[a-z][a-z0-9-]*$/.test(capability) || capability === "stop" || capability in Object.prototype || typeof policy?.command !== "string")) {
      diagnostics.push({ status: "error", code: "settings-invalid-capability", message: `Custom check ${capability} requires a valid name and an explicit command.` })
    }
    const fields = ["mode", "strategy", "provider", "command", "dependsOn"]
    if (object(policy) && Object.keys(policy).some((key) => !fields.includes(key))) diagnostics.push({ status: "error", code: "settings-unknown-policy-field", message: `Unknown policy field for ${capability}. Expected ${fields.join(", ")}.` })
    if (policy?.provider !== undefined && typeof policy.provider !== "string") diagnostics.push({ status: "error", code: "settings-invalid-provider", message: `${capability}.provider must be a string.` })
    if (policy?.dependsOn !== undefined && (!Array.isArray(policy.dependsOn) || policy.dependsOn.some((name) => !known.has(name)))) {
      diagnostics.push({ status: "error", code: "settings-invalid-dependency", message: `${capability}.dependsOn must list existing checks.` })
    }
    if (!object(policy)) diagnostics.push({ status: "error", code: "settings-invalid-policy", message: `Policy for ${capability} must be an object.` })
    if (policy?.mode !== undefined && !VALID_MODES.has(policy.mode)) diagnostics.push({ status: "error", code: "settings-invalid-mode", message: `${capability}.mode is invalid.` })
    if (policy?.strategy !== undefined && !VALID_STRATEGIES.has(policy.strategy)) diagnostics.push({ status: "error", code: "settings-invalid-strategy", message: `${capability}.strategy is invalid.` })
    if (policy?.command !== undefined && (typeof policy.command !== "string" || !policy.command.trim())) diagnostics.push({ status: "error", code: "settings-invalid-command", message: `${capability}.command must be a nonempty string.` })
  }
  for (const [phase, capabilities] of Object.entries(value.lifecycle ?? {})) {
    if (!Array.isArray(capabilities) || capabilities.some((name) => !known.has(name))) diagnostics.push({ status: "error", code: "settings-invalid-lifecycle", message: `Invalid capabilities for lifecycle phase: ${phase}.` })
  }
  if (!diagnostics.some((item) => item.status === "error")) {
    try {
      orderChecks(known, (name) => value.quality?.[name]?.dependsOn ?? [])
    } catch (error) {
      diagnostics.push({ status: "error", code: "settings-dependency-cycle", message: error.message })
    }
  }
  for (const [key, limit] of Object.entries(value.execution ?? {})) {
    const maximum = { timeoutMs: 3_600_000, maxOutputBytes: 1_048_576, maxParallel: 8 }[key]
    if (!Number.isInteger(maximum) || !Number.isInteger(limit) || limit < 1 || limit > maximum) diagnostics.push({ status: "error", code: "settings-invalid-execution", message: `Invalid execution limit: ${key}.` })
  }
  const promotion = value.promotion ?? {}
  if (promotion.mode !== undefined && !["off", "advisory"].includes(promotion.mode)) diagnostics.push({ status: "error", code: "settings-invalid-promotion-mode", message: "Use off or advisory for promotion.mode." })
  const threshold = promotion.repositoryThreshold
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) diagnostics.push({ status: "error", code: "settings-invalid-threshold", message: "promotion.repositoryThreshold must be between zero and one." })
  for (const [guard, policy] of Object.entries(value.guards ?? {})) {
    if (!object(policy) || (policy.mode !== undefined && !VALID_MODES.has(policy.mode))) diagnostics.push({ status: "error", code: "settings-invalid-guard", message: `Guard policy for ${guard} is invalid.` })
  }
  return { path, value, diagnostics }
}

const providerOrder = {
  lint: ["biome", "eslint"],
  format: ["biome", "prettier"],
  typecheck: ["typescript"],
  test: ["vitest", "jest"],
  build: []
}

export async function detectRepository(rootInput = process.cwd()) {
  const root = normalizeRoot(rootInput)
  const packagePath = join(root, "package.json")
  const packageResult = existsSync(packagePath) ? await readJson(packagePath) : { value: null, error: null }
  const scripts = packageResult.value?.scripts && typeof packageResult.value.scripts === "object" ? packageResult.value.scripts : {}
  const packageManager = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(root, "yarn.lock")) ? "yarn" : existsSync(join(root, "package-lock.json")) ? "npm" : packageResult.value ? "npm" : null
  const configEvidence = Object.entries(providerFiles).flatMap(([provider, files]) =>
    files.filter((file) => existsSync(join(root, file))).map((path) => ({ kind: "config", path, detail: provider })))
  const capabilities = {}
  for (const capability of CAPABILITIES) {
    const script = scriptNames[capability].find((name) => typeof scripts[name] === "string")
    const providers = providerOrder[capability]
    const configs = configEvidence.filter((item) => providers.includes(item.detail))
    const evidence = script ? [{ kind: "package-script", path: "package.json", detail: script }] : configs
    const provider = script && (providers.find((name) => scripts[script].toLowerCase().includes(name)) ?? providers.find((name) => configs.some((config) => config.detail === name)) ?? "package-script")
    capabilities[capability] = script
      ? { status: "detected", command: `${packageManager ?? "npm"} run ${script}`, provider, confidence: 0.95, evidence }
      : { status: "not-applicable", command: null, provider: null, confidence: 0, evidence }
  }
  return {
    root,
    stack: packageResult.value ? ["nodejs", packageResult.value.type === "module" ? "esm" : "javascript"] : [],
    packageManager,
    diagnostics: packageResult.error ? [{ status: "error", code: "package-json-invalid", message: packageResult.error }] : typeof scripts.format === "string" && !capabilities.format.command ? [{ status: "warning", code: "format-check-unresolved", message: "A format script exists, but may write files. Provide format:check / check:format or an explicit quality.format.command after inspecting it." }] : [],
    capabilities
  }
}

export async function resolveCapabilities(rootInput = process.cwd()) {
  const root = normalizeRoot(rootInput)
  const [detection, settings] = await Promise.all([detectRepository(root), loadSettings(root)])
  const resolved = Object.create(null)
  for (const capability of new Set([...CAPABILITIES, ...Object.keys(settings.value?.quality ?? {})])) {
    const detected = Object.hasOwn(detection.capabilities, capability) ? detection.capabilities[capability] : { command: null, provider: null, confidence: 0, evidence: [] }
    const override = settings.value?.quality?.[capability] ?? {}
    const policy = { ...DEFAULT_POLICY, ...override }
    const command = override.command ?? detected.command
    const provider = override.provider ?? detected.provider
    resolved[capability] = {
      capability,
      mode: policy.mode,
      strategy: policy.strategy,
      dependsOn: Array.isArray(policy.dependsOn) ? [...new Set(policy.dependsOn)] : [],
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

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

async function writeEvent(root, event) {
  const directory = join(root, ".harness")
  await mkdir(directory, { recursive: true })
  await appendFile(join(directory, "events.ndjson"), `${JSON.stringify(event)}\n`, "utf8")
}

async function changedFileCount(root, deadline) {
  const result = await runShell("git diff --name-only -z HEAD", root, { timeoutMs: Math.max(1, Math.min(5000, (deadline ?? Infinity) - Date.now())) })
  if (result.exitCode || result.outputTruncated) return null
  return result.stdout.split("\0").filter(Boolean).length
}

async function executeCheck(resolved, capability, options) {
  const item = resolved.capabilities[capability]
  if (item.status === "off") return { status: "skipped", capability, message: "Disabled by policy.", exitCode: 0 }
  if (!item.command) return { status: item.mode === "required" ? "error" : "not-applicable", capability, code: "capability-unresolved", message: "No existing check command was detected; configure an explicit command if needed.", exitCode: item.mode === "required" ? 1 : 0 }
  const filesChanged = options.changedFiles?.length ?? (item.strategy === "changed" ? await options.countChanges() : null)
  const strategy = item.strategy === "all" ? { requested: "all", effective: "all" } : { requested: item.strategy, effective: "all", reason: "The selected repository script has no safe, provider-neutral partial-target interface; running it unchanged." }
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const execution = { ...resolved.settings.value?.execution }
  if (options.deadline) execution.timeoutMs = Math.min(execution.timeoutMs ?? 120_000, Math.max(1, options.deadline - Date.now()))
  if (options.deadline && Date.now() >= options.deadline) return { status: "error", capability, code: "verification-budget-exhausted", message: "Hook time budget exhausted; run harness verify manually.", exitCode: 1 }
  const result = await runShell(item.command, resolved.root, execution)
  const event = {
    eventId: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    occurredAt: startedAt,
    sessionId: hash(options.sessionId ?? process.env.HARNESS_SESSION_ID ?? "local-session").slice(0, 24),
    kind: result.exitCode === 0 ? "recovery" : "violation",
    capability,
    provider: item.provider,
    phase: options.phase ?? "manual",
    outcome: result.exitCode === 0 ? "passed" : "failed",
    durationMs: Date.now() - started,
    scope: { filesChanged },
    fingerprint: hash(`${capability}:${item.provider ?? "unknown"}:${result.exitCode === 0 ? "pass" : "failure"}`),
    privacy: "local-only"
  }
  try {
    await writeEvent(resolved.root, event)
  } catch (error) {
    return { status: "error", capability, code: "event-store-write-failed", message: error instanceof Error ? error.message : String(error), result, exitCode: result.exitCode || 1 }
  }
  return { status: result.exitCode === 0 ? "passed" : "failed", capability, command: item.command, provider: item.provider, strategy, event, result, exitCode: result.exitCode }
}

export async function planVerification(rootInput, options = {}) {
  return buildPlan(await resolveCapabilities(rootInput), options)
}

async function runGraph(rootInput, options) {
  const started = Date.now()
  const resolved = await resolveCapabilities(rootInput)
  const plan = buildPlan(resolved, options)
  const { phase, diagnostics } = plan
  if (plan.exitCode) return { phase, runs: [], diagnostics, exitCode: plan.exitCode }
  let changes
  const countChanges = () => (changes ??= changedFileCount(resolved.root, options.deadline))
  const runs = await executePlan(plan, (capability) => executeCheck(resolved, capability, { ...options, phase, countChanges }))
  const requiredFailures = runs.filter((run) => run.exitCode !== 0 && run.mode === "required").map((run) => run.capability)
  const metrics = { elapsedMs: Date.now() - started, executed: runs.filter((run) => run.result).length, blocked: runs.filter((run) => run.status === "blocked").length }
  const findings = runs.some((run) => run.exitCode || run.status === "not-applicable")
  const status = requiredFailures.length ? "failed" : findings ? "findings" : metrics.executed ? "passed" : "no-checks"
  return { phase, status, runs, requiredFailures, metrics, exitCode: requiredFailures.length ? 1 : 0 }
}

export async function runCapability(rootInput, capability, options = {}) {
  if (typeof capability !== "string") return { status: "error", code: "unknown-capability", message: "Specify a check name.", exitCode: 2 }
  const report = await runGraph(rootInput, { phase: "manual", ...options, target: capability })
  if (report.diagnostics) return { capability, status: "error", code: report.diagnostics.some((item) => item.code === "unknown-capability") ? "unknown-capability" : "configuration-invalid", diagnostics: report.diagnostics, exitCode: 2 }
  const target = report.runs.pop()
  return report.runs.length ? { ...target, prerequisites: report.runs } : target
}

export async function verify(rootInput, options = {}) {
  return runGraph(rootInput, options)
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
    const latest = new Map(events.map((event) => [`${event.capability}:${event.provider}`, event]))
    diagnostics.push({ status: "pass", code: "event-store", message: "Local event store is the source of truth; it is never sent externally by this plugin." })
    for (const event of latest.values()) if (event.outcome === "failed") diagnostics.push({ status: "error", code: "command-last-failed", message: `The most recent recorded ${event.capability} run failed during ${event.phase}.` })
  } else {
    diagnostics.push({ status: "warning", code: "event-store", message: "No local event store exists yet; run a capability to create one." })
  }
  diagnostics.push({ status: "warning", code: "hooks-best-effort", message: "Hook execution is optional; use `harness verify` for reproducible checks." })
  return { ...resolved, diagnostics }
}

export async function adopt(rootInput, pluginRoot, write = false) {
  const resolved = await resolveCapabilities(rootInput)
  if (resolved.settings.diagnostics.some((item) => item.status === "error")) {
    return { written: false, diagnostics: resolved.settings.diagnostics, exitCode: 2 }
  }
  if (resolved.settings.value) {
    return { written: false, proposal: resolved.settings.value, message: "harness-settings.json already exists. Review the current configuration with plan or doctor." }
  }
  const quality = {}
  for (const [capability, item] of Object.entries(resolved.capabilities)) {
    quality[capability] = { mode: item.command ? (capability === "lint" || capability === "format" ? "required" : "advisory") : "off", strategy: capability === "lint" || capability === "format" ? "changed" : "affected" }
  }
  const ready = Object.keys(quality).filter((name) => quality[name].mode !== "off")
  const fast = ["lint", "format", "typecheck"].filter((name) => ready.includes(name))
  const proposal = {
    $schema: "./.harness/schema/harness-settings.schema.json",
    version: 1,
    quality,
    lifecycle: { postEdit: [], stop: fast.length ? fast : ready.slice(0, 1) },
    execution: { timeoutMs: 120_000, maxOutputBytes: 8192, maxParallel: 1 },
    guards: { dangerousCommands: { mode: "required" }, protectedFiles: { mode: "required" }, secrets: { mode: "required" } },
    promotion: { mode: "advisory", issueMode: "manual", repositoryThreshold: 0.7, pluginThreshold: 0.8 }
  }
  if (!write) return { written: false, proposal, message: "Dry run only. Re-run with --write after reviewing the proposal." }
  const settingsPath = join(resolved.root, "harness-settings.json")
  if (existsSync(settingsPath)) return { written: false, proposal, message: "harness-settings.json already exists; refusing to overwrite it." }
  await writeFile(settingsPath, `${JSON.stringify(proposal, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
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
    { expression: /\brm\s+(?:-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*|-rf|-fr)\s+(?:\/|~)(?:\s|$)/, reason: "Recursive deletion targets / or the home directory." },
    { expression: /\b(?:git\s+reset\s+--hard|git\s+clean\s+-[A-Za-z]*f)/, reason: "Tool input contains a destructive Git command." },
    { expression: /\b(?:mkfs|dd)\b/, reason: "Tool input contains a disk-destructive command." }
  ]
  const match = patterns.find((item) => item.expression.test(command))
  return match ? { decision: mode === "advisory" ? "warn" : "deny", reason: match.reason } : { decision: "allow" }
}

export function evaluateToolGuard(command, settings = null) {
  const dangerous = evaluateDangerousCommand(command, settings)
  if (dangerous.decision === "deny") return dangerous
  if (typeof command !== "string") return { decision: "allow" }
  let warning = dangerous
  const secretsMode = settings?.guards?.secrets?.mode ?? "required"
  if (secretsMode !== "off" && /(?:\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9_-]{20,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(command)) {
    const reason = "Tool input contains a likely secret."
    if (secretsMode !== "advisory") return { decision: "deny", reason }
    warning = { decision: "warn", reason }
  }
  const protectedMode = settings?.guards?.protectedFiles?.mode ?? "required"
  if (protectedMode !== "off" && /\*\*\*\s+(?:Add|Update|Delete) File:\s+(?:\.env(?!\.example\b)(?:\.[^\s]+)?|appsettings(?:\.[^\s]+)?\.json)\b/.test(command)) {
    const reason = "Tool input edits a protected environment configuration file."
    if (protectedMode !== "advisory") return { decision: "deny", reason }
    warning = { decision: "warn", reason }
  }
  return warning
}

export async function analyzePromotion(rootInput, options = {}) {
  const root = normalizeRoot(rootInput)
  const settings = await loadSettings(root)
  if (settings.diagnostics.some((item) => item.status === "error")) return { candidates: [], proposals: [], diagnostics: settings.diagnostics, written: false, exitCode: 2 }
  const policy = settings.value?.promotion
  if (policy?.mode === "off") return { candidates: [], proposals: [], status: "off", written: false }
  const eventPath = join(root, ".harness", "events.ndjson")
  const lines = existsSync(eventPath) ? (await readFile(eventPath, "utf8")).split(/\r?\n/).filter(Boolean) : []
  const events = lines.flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }).filter((event) => event?.privacy === "local-only")
  const groups = new Map()
  const unresolved = new Map()
  for (const event of events) {
    const key = JSON.stringify([event.capability, event.provider])
    if (event.kind === "recovery" && event.outcome === "passed") {
      const previous = unresolved.get(key)
      if (previous) previous.successfulRecoveries++
      unresolved.delete(key)
      continue
    }
    if (event.kind !== "violation") continue
    const group = groups.get(event.fingerprint) ?? { events: [], successfulRecoveries: 0, capability: event.capability, provider: event.provider, fingerprint: event.fingerprint }
    group.events.push(event)
    groups.set(event.fingerprint, group)
    unresolved.set(key, group)
  }
  const candidates = [...groups.values()].map((group) => {
    const sessions = new Set(group.events.map((event) => event.sessionId)).size
    const days = new Set(group.events.map((event) => String(event.occurredAt).slice(0, 10))).size
    const recurrence = Math.min(1, group.events.length / 3)
    const { successfulRecoveries } = group
    const confidence = group.provider && group.provider !== "unknown" ? 0.95 : 0.6
    const impact = group.capability === "lint" || group.capability === "typecheck" ? 0.95 : 0.7
    const fixability = successfulRecoveries > 0 ? 0.95 : 0.9
    const distribution = Math.min(1, sessions / 3)
    const score = Number((recurrence * confidence * impact * fixability * distribution).toFixed(3))
    const level = score >= (policy?.repositoryThreshold ?? 0.7) && sessions >= 3 ? "L2 repository proposal" : score >= 0.4 ? "L1 advisory" : "L0 observe"
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
  const markdown = ["# Harness Health", "", `Last analyzed: ${new Date().toISOString()}`, "", "| Pattern | Occurrences | Sessions | Days | Recoveries | Score | Status |", "|---|---:|---:|---:|---:|---:|---|", ...candidates.map((item) => `| ${item.capability} (${item.provider ?? "unknown"}) | ${item.occurrences} | ${item.sessions} | ${item.days} | ${item.successfulRecoveries} | ${item.score} | ${item.level} |`), "", "## Promotion proposals", "", ...proposals.flatMap((proposal) => [`### ${proposal.promotionId}`, "", `- Evidence: ${proposal.evidence.occurrences} occurrences / ${proposal.evidence.distinctSessions} sessions / ${proposal.evidence.days} days`, `- Successful recoveries: ${proposal.evidence.successfulRecoveries}`, `- Target: ${proposal.proposedTarget}`, `- Change: ${proposal.suggestedChange}`, `- Cost: ${proposal.estimatedCost}`, `- Risk: ${proposal.risk}`, `- Rollback: ${proposal.rollback}`, ""]), proposals.length === 0 ? "No candidate met the repository-proposal threshold." : "", "", "Review these local proposals before changing repository policy.", ""].join("\n")
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
