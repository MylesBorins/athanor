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
  const runtime = entry.runtime
  const specs = listKeys(runtime)
  const tokens: string[] = []

  for (const spec of specs) {
    const val = effective[spec.jsonName]
    if (val !== undefined && val !== "") {
      const keyName = spec.aliases.find(a => a.includes("-")) ?? spec.aliases[0]!
      tokens.push(`${keyName}=${val}`)
    }
  }

  if (tokens.length > 0) {
    return `athanor preset ${entry.slug} set ${tokens.join(" ")}`
  }

  return JSON.stringify(effective, null, 2)
}
