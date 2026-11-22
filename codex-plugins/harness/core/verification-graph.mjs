// Dependencies are check names. A dependency must pass, even when its own
// failure would only be advisory as a standalone lifecycle check.
export function orderChecks(roots, dependencies) {
  const ordered = new Set()
  const visiting = new Set()
  function visit(name) {
    if (ordered.has(name)) return
    if (visiting.has(name)) {
      const path = [...visiting]
      throw new Error(`Dependency cycle: ${[...path.slice(path.indexOf(name)), name].join(" -> ")}`)
    }
    visiting.add(name)
    for (const dependency of dependencies(name)) visit(dependency)
    visiting.delete(name)
    ordered.add(name)
  }
  for (const name of roots) visit(name)
  return [...ordered]
}

export function buildPlan(resolved, { phase = "stop", hook, target } = {}) {
  const { capabilities, settings, detection } = resolved
  const diagnostics = [...settings.diagnostics, ...detection.diagnostics].filter((item) => item.status === "error")
  const maxParallel = settings.value?.execution?.maxParallel ?? 1
  const plan = { phase, maxParallel, nodes: [], diagnostics, exitCode: 0 }
  if (target !== undefined && !Object.hasOwn(capabilities, target)) {
    diagnostics.push({ status: "error", code: "unknown-capability", message: `Unsupported capability: ${target}.` })
  }
  if (target === undefined && !["stop", "postEdit"].includes(phase) && !Object.hasOwn(settings.value?.lifecycle ?? {}, phase)) {
    diagnostics.push({ status: "error", code: "unknown-phase", message: `No lifecycle phase named ${phase} is configured.` })
  }
  if (diagnostics.length) return { ...plan, exitCode: 2 }

  const names = Object.keys(capabilities)
  const lifecycle = settings.value?.lifecycle ?? {}
  const required = phase === "postEdit" ? [] : names.filter((name) => capabilities[name].mode === "required")
  const defaults = phase === "postEdit" ? [] : hook ? ["lint", "format", "typecheck"] : names.filter((name) => capabilities[name].status === "ready")
  const selected = Object.hasOwn(lifecycle, phase) ? lifecycle[phase] : defaults
  const roots = target === undefined ? [...selected, ...required] : [target]
  const dependencies = (name) => capabilities[name].mode === "off" ? [] : capabilities[name].dependsOn
  const order = orderChecks(roots, dependencies)
  plan.nodes = order.map((name) => {
    const { capability, command, mode, status } = capabilities[name]
    return { capability, command, mode, status, dependsOn: dependencies(name) }
  })
  return plan
}

export async function executePlan(plan, execute) {
  const completed = new Map()
  const active = new Map()
  const pending = new Set(plan.nodes)
  while (pending.size || active.size) {
    for (const node of pending) {
      if (active.size >= plan.maxParallel) break
      if (!node.dependsOn.every((name) => completed.has(name))) continue
      pending.delete(node)
      const blockedBy = node.dependsOn.filter((name) => completed.get(name).status !== "passed")
      if (blockedBy.length) {
        completed.set(node.capability, { capability: node.capability, mode: node.mode, status: "blocked", code: "dependency-incomplete", blockedBy, exitCode: 1 })
        continue
      }
      active.set(node.capability, execute(node.capability).then((run) => ({ ...run, mode: node.mode })))
    }
    if (active.size) {
      const run = await Promise.race(active.values())
      completed.set(run.capability, run)
      active.delete(run.capability)
    }
  }
  return plan.nodes.map(({ capability }) => completed.get(capability))
}
