import { readFile } from "node:fs/promises"

const models = new Map([
  ["gpt-6-astra", "astra"],
  ["gpt-5.6-sol", "sol"],
  ["gpt-5.6-terra", "terra"],
  ["gpt-5.6-luna", "luna"]
])

export async function modelGuidance(model) {
  if (model !== undefined && !models.has(model)) return { status: "error", code: "unknown-model", supportedModels: [...models.keys()], exitCode: 2 }
  const common = await readFile(new URL("../references/workflow.md", import.meta.url), "utf8")
  const specific = model ? await readFile(new URL(`../references/models/${models.get(model)}.md`, import.meta.url), "utf8") : null
  return { model: model ?? null, advisory: true, changesModel: false, common, specific }
}
