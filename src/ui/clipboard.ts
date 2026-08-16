import { execSync } from "child_process"
import type { ModelEntry } from "../types/index.js"
import { listKeys } from "../presets/edit.js"

export function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text, timeout: 2000 })
      return true
    }
    if (process.platform === "win32") {
      execSync("clip", { input: text, timeout: 2000 })
      return true
    }
    try {
      execSync("wl-copy", { input: text, timeout: 2000 })
      return true
    } catch {
      try {
        execSync("xclip -selection clipboard", { input: text, timeout: 2000 })
        return true
      } catch {
        execSync("xsel -b", { input: text, timeout: 2000 })
        return true
      }
    }
  } catch {
    return false
  }
}

export function formatPresetCopyText(
  entry: ModelEntry,
  effective: Record<string, string | number>
): string {
  const isMlx = entry.runtime === "mlx"
  const runtimeLabel = isMlx ? `mlx-${entry.mlxFlavor ?? "lm"}` : entry.runtime
  const specs = listKeys(entry.runtime)

  const lines: string[] = [
    `Model: ${entry.slug}`,
    `Runtime: ${runtimeLabel} (Port ${entry.port})`,
    ``,
    `Effective Settings:`
  ]

  let bag: Record<string, unknown> | undefined
  const active = entry.formula ?? entry.preset
  if (active) {
    if (active.runtime === "mlx" && entry.runtime === "mlx") {
      bag = active.mlx
    } else if (active.runtime === "llama.cpp" && entry.runtime === "llama.cpp") {
      bag = active.llama
    }
  }

  for (const spec of specs) {
    const val = effective[spec.jsonName]
    if (val !== undefined && val !== "") {
      const keyName = spec.aliases.find(a => a.includes("-")) ?? spec.aliases[0]!
      const isOverride = bag && bag[spec.jsonName] !== undefined
      lines.push(`  ${keyName}: ${val}${isOverride ? " (*)" : ""}`)
    }
  }

  if (bag && Object.keys(bag).length > 0) {
    const setTokens: string[] = []
    for (const [jsonName, val] of Object.entries(bag)) {
      if (val === undefined) continue
      const spec = specs.find(s => s.jsonName === jsonName)
      const keyName = spec ? (spec.aliases.find(a => a.includes("-")) ?? spec.aliases[0]!) : jsonName
      setTokens.push(`${keyName}=${val}`)
    }
    if (setTokens.length > 0) {
      lines.push(``)
      lines.push(`Recreate Preset:`)
      lines.push(`  athanor preset ${entry.slug} set ${setTokens.join(" ")}`)
    }
  }

  return lines.join("\n")
}
