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
  const preset = entry.preset
  const runtime = entry.runtime
  let bag: Record<string, unknown> | undefined
  if (preset) {
    if (preset.runtime === "mlx" && runtime === "mlx") {
      bag = preset.mlx
    } else if (preset.runtime === "llama.cpp" && runtime === "llama.cpp") {
      bag = preset.llama
    }
  }

  if (bag && Object.keys(bag).length > 0) {
    const specs = listKeys(runtime)
    const tokens: string[] = []
    for (const [jsonName, val] of Object.entries(bag)) {
      if (val === undefined) continue
      const spec = specs.find(s => s.jsonName === jsonName)
      const keyName = spec ? (spec.aliases.find(a => a.includes("-")) ?? spec.aliases[0]!) : jsonName
      tokens.push(`${keyName}=${val}`)
    }
    if (tokens.length > 0) {
      return `athanor preset ${entry.slug} set ${tokens.join(" ")}`
    }
  }

  return JSON.stringify(effective, null, 2)
}
