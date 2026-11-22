import { readFile } from "node:fs/promises"

// Only bundled reference names can become paths. Other model IDs are opaque.
const profiles = new Map([
  ["gpt-6.2-astra", "astra"], ["gpt-6-astra", "astra"],
  ["gpt-6.2-sol", "sol"], ["gpt-6.1-sol", "sol"], ["gpt-6-sol", "sol"], ["gpt-5.6-sol", "sol"],
  ["gpt-6.1-terra", "terra"], ["gpt-5.6-terra", "terra"],
  ["gpt-6-luna", "luna"], ["gpt-5.6-luna", "luna"]
])

export async function modelGuidance(model) {
  const profile = profiles.get(model)
  const common = await readFile(new URL("../references/workflow.md", import.meta.url), "utf8")
  const specific = profile ? await readFile(new URL(`../references/models/${profile}.md`, import.meta.url), "utf8") : null
  return { model: model ?? null, advisory: true, changesModel: false, common, specific }
}
