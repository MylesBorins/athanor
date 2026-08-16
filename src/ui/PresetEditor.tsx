import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { ModelEntry } from "../types/index.js"
import { getModel } from "../registry/index.js"
import { mergedConfigFor } from "../adapters/index.js"
import { supervisor } from "../supervisor/index.js"
import { setFlavor, setPreset } from "../app/models.js"
import {
  listKeys,
  setPresetFields,
  unsetPresetFields
} from "../presets/edit.js"
import { deleteUserRecipe, listRecipes, recipeToPreset, saveUserRecipe, type Recipe } from "../presets/recipes.js"
import { copyToClipboard, formatPresetCopyText } from "./clipboard.js"

export interface PresetEditorProps {
  entryId: string
  width?: number
  onClose: (message: string) => void
}

// In-memory value for the key currently being edited. Kept separate
// from the saved preset so Esc cleanly discards.
type EditState = { jsonName: string; buffer: string } | null

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function presetValueFor(entry: ModelEntry, jsonName: string): string | number | undefined {
  if (!entry.preset || entry.preset.runtime !== entry.runtime) return undefined
  const bag = entry.preset.runtime === "mlx" ? entry.preset.mlx : entry.preset.llama
  return (bag as Record<string, string | number | undefined>)[jsonName]
}

export const STANDARD_CTX_SIZES = [
  2048,
  4096,
  8192,
  16384,
  32768,
  65536,
  98304,
  131072,
  163840,
  196608,
  229376,
  262144,
  294912,
  327680,
  360448,
  393216,
  425984,
  458752,
  491520,
  524288
]

export function getNextStandardCtx(currentStr: string, direction: "left" | "right"): number {
  const current = parseInt(currentStr, 10)
  if (isNaN(current)) {
    return 4096
  }
  if (direction === "left") {
    const filtered = STANDARD_CTX_SIZES.filter(s => s < current)
    if (filtered.length > 0) return filtered[filtered.length - 1]!
    return STANDARD_CTX_SIZES[0]!
  } else {
    const filtered = STANDARD_CTX_SIZES.filter(s => s > current)
    if (filtered.length > 0) return filtered[0]!
    return STANDARD_CTX_SIZES[STANDARD_CTX_SIZES.length - 1]!
  }
}

export const STANDARD_SLOT_SIZES = [1, 2, 4, 8, 16, 32, 64]
export function getNextSlotSize(currentStr: string, direction: "left" | "right"): number {
  const current = parseInt(currentStr, 10)
  if (isNaN(current)) return 1
  if (direction === "left") {
    const filtered = STANDARD_SLOT_SIZES.filter(s => s < current)
    if (filtered.length > 0) return filtered[filtered.length - 1]!
    return STANDARD_SLOT_SIZES[0]!
  } else {
    const filtered = STANDARD_SLOT_SIZES.filter(s => s > current)
    if (filtered.length > 0) return filtered[0]!
    return STANDARD_SLOT_SIZES[STANDARD_SLOT_SIZES.length - 1]!
  }
}

export const STANDARD_GPU_LAYERS = [0, 16, 32, 48, 64, 80, 999]
export function getNextGpuLayer(currentStr: string, direction: "left" | "right"): number {
  const current = parseInt(currentStr, 10)
  if (isNaN(current)) return 0
  if (direction === "left") {
    const filtered = STANDARD_GPU_LAYERS.filter(s => s < current)
    if (filtered.length > 0) return filtered[filtered.length - 1]!
    return STANDARD_GPU_LAYERS[0]!
  } else {
    const filtered = STANDARD_GPU_LAYERS.filter(s => s > current)
    if (filtered.length > 0) return filtered[0]!
    return STANDARD_GPU_LAYERS[STANDARD_GPU_LAYERS.length - 1]!
  }
}

export const SPEC_TYPES = ["none", "draft", "draft-simple", "draft-mtp", "ngram-simple"]
export function getNextSpecType(currentStr: string, direction: "left" | "right"): string {
  const idx = SPEC_TYPES.indexOf(currentStr)
  if (idx < 0) return SPEC_TYPES[0]!
  if (direction === "left") {
    return SPEC_TYPES[Math.max(0, idx - 1)]!
  } else {
    return SPEC_TYPES[Math.min(SPEC_TYPES.length - 1, idx + 1)]!
  }
}

export const STANDARD_REPEAT_LAST_N = [-1, 0, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]
export function getNextRepeatLastN(currentStr: string, direction: "left" | "right"): number {
  const current = parseInt(currentStr, 10)
  if (isNaN(current)) return 64
  if (direction === "left") {
    const filtered = STANDARD_REPEAT_LAST_N.filter(s => s < current)
    if (filtered.length > 0) return filtered[filtered.length - 1]!
    return STANDARD_REPEAT_LAST_N[0]!
  } else {
    const filtered = STANDARD_REPEAT_LAST_N.filter(s => s > current)
    if (filtered.length > 0) return filtered[0]!
    return STANDARD_REPEAT_LAST_N[STANDARD_REPEAT_LAST_N.length - 1]!
  }
}

export function cycleFloat(
  currentStr: string,
  direction: "left" | "right",
  step: number,
  min: number,
  max: number,
  fallback: number
): number {
  const val = parseFloat(currentStr)
  if (isNaN(val)) return fallback
  const next = direction === "left" ? val - step : val + step
  const clamped = Math.max(min, Math.min(max, next))
  return Math.round(clamped * 100) / 100
}

export const CACHE_TYPES = ["f16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1", "bf16", "f32"]
export function getNextCacheType(currentStr: string, direction: "left" | "right"): string {
  const idx = CACHE_TYPES.indexOf(currentStr)
  if (idx < 0) return CACHE_TYPES[0]!
  if (direction === "left") {
    return CACHE_TYPES[Math.max(0, idx - 1)]!
  } else {
    return CACHE_TYPES[Math.min(CACHE_TYPES.length - 1, idx + 1)]!
  }
}

export const FLASH_ATTN_MODES = ["auto", "on", "off"]
export function getNextFlashAttn(currentStr: string, direction: "left" | "right"): string {
  const idx = FLASH_ATTN_MODES.indexOf(currentStr)
  if (idx < 0) return FLASH_ATTN_MODES[0]!
  if (direction === "left") {
    return FLASH_ATTN_MODES[Math.max(0, idx - 1)]!
  } else {
    return FLASH_ATTN_MODES[Math.min(FLASH_ATTN_MODES.length - 1, idx + 1)]!
  }
}

export const SPECULATIVE_MODES = ["auto", "enabled", "disabled"]
export function getNextSpeculativeMode(currentStr: string, direction: "left" | "right"): string {
  const idx = SPECULATIVE_MODES.indexOf(currentStr)
  if (idx < 0) return SPECULATIVE_MODES[0]!
  if (direction === "left") {
    return SPECULATIVE_MODES[Math.max(0, idx - 1)]!
  } else {
    return SPECULATIVE_MODES[Math.min(SPECULATIVE_MODES.length - 1, idx + 1)]!
  }
}

export const CYCLABLE_KEYS = [
  "contextWindow",
  "ctxSize",
  "promptCacheSize",
  "temp",
  "topP",
  "topK",
  "minP",
  "parallel",
  "decodeConcurrency",
  "promptConcurrency",
  "nGpuLayers",
  "specDraftNgl",
  "specType",
  "repeatPenalty",
  "presencePenalty",
  "frequencyPenalty",
  "repeatLastN",
  "cacheTypeK",
  "cacheTypeV",
  "flashAttn",
  "specDraftCacheTypeK",
  "specDraftCacheTypeV",
  "speculativeMode"
]

export const PresetEditor: React.FC<PresetEditorProps> = ({
  entryId,
  width = 88,
  onClose
}) => {
  const initial = getModel(entryId)
  const [entry, setEntry] = useState<ModelEntry | undefined>(initial)
  const [cursor, setCursor] = useState(0)
  const [edit, setEdit] = useState<EditState>(null)
  const [savingRecipe, setSavingRecipe] = useState<{ buffer: string } | null>(null)
  const [recipesList, setRecipesList] = useState<Recipe[]>(() => listRecipes())
  const [notice, setNotice] = useState("")

  const keys = useMemo(() => entry ? listKeys(entry.runtime) : [], [entry])
  const effective = useMemo(
    () => entry ? (mergedConfigFor(entry) as unknown as Record<string, string | number>) : {},
    [entry]
  )

  const totalItems = keys.length + recipesList.length

  function refresh(msg: string): void {
    setEntry(getModel(entryId))
    setNotice(msg)
  }

  function persistPreset(preset: ModelEntry["preset"], msg: string): void {
    setPreset(entryId, preset)
    refresh(msg)
  }

  function persistFlavor(mlxFlavor: ModelEntry["mlxFlavor"], msg: string): void {
    setFlavor(entryId, mlxFlavor)
    refresh(msg)
  }

  useInput((input, key) => {
    if (!entry) { if (key.escape) onClose(""); return }

    if (savingRecipe) {
      if (key.escape) { setSavingRecipe(null); return }
      if (key.return) {
        const name = savingRecipe.buffer.trim()
        if (!name) { setNotice("error: recipe name cannot be empty"); return }
        const recipe: Recipe = {
          name,
          description: `Custom recipe saved from ${entry.slug}`,
          mlx: entry.preset?.runtime === "mlx" ? entry.preset.mlx : undefined,
          llama: entry.preset?.runtime === "llama.cpp" ? entry.preset.llama : undefined,
          source: "user"
        }
        saveUserRecipe(recipe)
        setRecipesList(listRecipes())
        setSavingRecipe(null)
        setNotice(`✓ recipe "${name}" saved to ~/.athanor/recipes.json`)
        return
      }
      if (key.backspace || key.delete) {
        setSavingRecipe(s => s ? { buffer: s.buffer.slice(0, -1) } : s)
        return
      }
      if (input && /^[a-zA-Z0-9_\-]$/.test(input)) {
        setSavingRecipe(s => s ? { buffer: s.buffer + input } : s)
      }
      return
    }

    if (edit) {
      if (key.escape) { setEdit(null); return }
      if (key.return) {
        try {
          const preset = setPresetFields(entry, [[edit.jsonName, edit.buffer]])
          persistPreset(preset, `set ${edit.jsonName}=${edit.buffer}`)
          setEdit(null)
        } catch (err) { setNotice(`error: ${errMsg(err)}`) }
        return
      }
      if (key.leftArrow || key.rightArrow) {
        const dir = key.leftArrow ? "left" : "right"
        let nextVal: string | number | undefined = undefined

        if (["contextWindow", "ctxSize", "promptCacheSize"].includes(edit.jsonName)) {
          nextVal = getNextStandardCtx(edit.buffer, dir)
        } else if (edit.jsonName === "temp") {
          nextVal = cycleFloat(edit.buffer, dir, 0.1, 0.0, 2.0, 0.0)
        } else if (edit.jsonName === "topP") {
          nextVal = cycleFloat(edit.buffer, dir, 0.05, 0.0, 1.0, 1.0)
        } else if (edit.jsonName === "topK") {
          nextVal = cycleFloat(edit.buffer, dir, 5, 0, 200, 0)
        } else if (edit.jsonName === "minP") {
          nextVal = cycleFloat(edit.buffer, dir, 0.01, 0.0, 1.0, 0.0)
        } else if (["parallel", "decodeConcurrency", "promptConcurrency"].includes(edit.jsonName)) {
          nextVal = getNextSlotSize(edit.buffer, dir)
        } else if (["nGpuLayers", "specDraftNgl"].includes(edit.jsonName)) {
          nextVal = getNextGpuLayer(edit.buffer, dir)
        } else if (edit.jsonName === "specType") {
          nextVal = getNextSpecType(edit.buffer, dir)
        } else if (edit.jsonName === "repeatPenalty") {
          nextVal = cycleFloat(edit.buffer, dir, 0.05, 0.0, 2.0, 1.0)
        } else if (edit.jsonName === "presencePenalty") {
          nextVal = cycleFloat(edit.buffer, dir, 0.1, 0.0, 2.0, 0.0)
        } else if (edit.jsonName === "frequencyPenalty") {
          nextVal = cycleFloat(edit.buffer, dir, 0.1, 0.0, 2.0, 0.0)
        } else if (edit.jsonName === "repeatLastN") {
          nextVal = getNextRepeatLastN(edit.buffer, dir)
        } else if (["cacheTypeK", "cacheTypeV", "specDraftCacheTypeK", "specDraftCacheTypeV"].includes(edit.jsonName)) {
          nextVal = getNextCacheType(edit.buffer, dir)
        } else if (edit.jsonName === "flashAttn") {
          nextVal = getNextFlashAttn(edit.buffer, dir)
        } else if (edit.jsonName === "speculativeMode") {
          nextVal = getNextSpeculativeMode(edit.buffer, dir)
        }

        if (nextVal !== undefined) {
          setEdit(e => e ? { ...e, buffer: String(nextVal) } : e)
          return
        }
      }
      if (key.backspace || key.delete) {
        setEdit(e => e ? { ...e, buffer: e.buffer.slice(0, -1) } : e)
        return
      }
      const spec = keys.find(k => k.jsonName === edit.jsonName)
      const isStringField = spec?.type === "string"
      if (input) {
        const allowed = isStringField ? /^[a-zA-Z0-9_\-./:]$/ : /^[0-9.-]$/
        if (allowed.test(input)) {
          setEdit(e => e ? { ...e, buffer: e.buffer + input } : e)
        }
      }
      return
    }

    if (key.escape) { onClose(notice); return }
    if (key.downArrow) setCursor(c => Math.min(totalItems - 1, c + 1))
    else if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    else if (key.return) {
      if (cursor < keys.length) {
        const spec = keys[cursor]
        if (spec) {
          const existing = presetValueFor(entry, spec.jsonName)
          const start = existing !== undefined ? String(existing) : String(effective[spec.jsonName] ?? "")
          setEdit({ jsonName: spec.jsonName, buffer: start })
        }
      } else {
        const recipeIndex = cursor - keys.length
        const r = recipesList[recipeIndex]
        if (r) {
          const preset = recipeToPreset(r, entry.runtime)
          persistPreset(preset, `applied recipe: ${r.name}`)
        }
      }
    }
    else if (input === "s") {
      setSavingRecipe({ buffer: "" })
    }
    else if ((input === "d" || key.delete) && cursor >= keys.length) {
      const recipeIndex = cursor - keys.length
      const r = recipesList[recipeIndex]
      if (r && r.source === "user") {
        deleteUserRecipe(r.name)
        setRecipesList(listRecipes())
        setCursor(c => Math.max(0, c - 1))
        setNotice(`✓ recipe "${r.name}" deleted`)
      }
    }
    else if (input === "u") {
      if (cursor < keys.length) {
        const spec = keys[cursor]
        if (!spec) return
        try {
          const preset = unsetPresetFields(entry, [spec.jsonName])
          persistPreset(preset, `unset ${spec.jsonName}`)
        } catch (err) { setNotice(`error: ${errMsg(err)}`) }
      }
    }
    else if (input === "y") {
      const textToCopy = formatPresetCopyText(entry, effective)
      const ok = copyToClipboard(textToCopy)
      if (ok) {
        setNotice("✓ copied audit configuration to clipboard!")
      } else {
        setNotice("error: unable to access system clipboard")
      }
    }
    else if (input === "c") { persistPreset(undefined, "preset cleared") }
    else if (input === "v" && entry.runtime === "mlx") {
      const next = entry.mlxFlavor === "vlm" ? "lm" : "vlm"
      const noVlmCap = !(entry.mlxCapabilities ?? []).includes("vlm")
      const running = supervisor.list().some(i => i.id === entry.id)
      const warn = next === "vlm" && noVlmCap
        ? " · ⚠ no vision tower detected, mlx_vlm.server may fail to load" : ""
      const restart = running ? " · restart to apply" : ""
      persistFlavor(next, `flavor → mlx-${next}${warn}${restart}`)
    }
    else if (input && /^[1-9]$/.test(input)) {
      const idx = Number(input) - 1
      const r = recipesList[idx]
      if (!r) return
      const preset = recipeToPreset(r, entry.runtime)
      persistPreset(preset, `recipe: ${r.name}`)
    }
  })

  if (!entry) {
    return (
      <Box width={width} flexDirection="column" borderStyle="round" borderColor="red" padding={1} backgroundColor="black">
        <Text color="red" backgroundColor="black">model not found</Text>
      </Box>
    )
  }

  const isMlx     = entry.runtime === "mlx"
  const isVlm     = isMlx && entry.mlxFlavor === "vlm"
  const hasVlmCap = isMlx && (entry.mlxCapabilities ?? []).includes("vlm")
  const runtimeLabel = isMlx ? `mlx-${entry.mlxFlavor ?? "lm"}` : entry.runtime
  const keyColWidth = 22

  const MAX_VISIBLE_KEYS = 7
  const activeKeyCursor = Math.min(cursor, keys.length - 1)
  const windowStart = Math.max(
    0,
    Math.min(activeKeyCursor - Math.floor(MAX_VISIBLE_KEYS / 2), keys.length - MAX_VISIBLE_KEYS)
  )
  const windowEnd = Math.min(keys.length, windowStart + MAX_VISIBLE_KEYS)
  const visibleKeys = keys.slice(windowStart, windowEnd)
  const countAbove = windowStart
  const countBelow = keys.length - windowEnd

  return (
    <Box width={width} flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} backgroundColor="black">
      <Text bold color="cyan" backgroundColor="black">Preset editor</Text>
      <Text wrap="truncate-end" backgroundColor="black">
        <Text backgroundColor="black">{entry.slug} </Text>
        <Text dimColor backgroundColor="black">({runtimeLabel})</Text>
      </Text>
      {isMlx && hasVlmCap && !isVlm
        ? <Text dimColor wrap="truncate-end" backgroundColor="black">vision tower detected — press <Text bold color="cyan" backgroundColor="black">v</Text> to switch to mlx-vlm</Text>
        : null}
      <Text backgroundColor="black"> </Text>
      <Text dimColor backgroundColor="black">
        Tunable keys  (override marked with *){keys.length > MAX_VISIBLE_KEYS ? ` · showing ${windowStart + 1}-${windowEnd} of ${keys.length}` : ""}
      </Text>
      {countAbove > 0 ? <Text dimColor backgroundColor="black">  ▲ {countAbove} more above</Text> : null}
      {visibleKeys.map((k, relIndex) => {
        const i = windowStart + relIndex
        const override = presetValueFor(entry, k.jsonName)
        const value = override !== undefined ? override : effective[k.jsonName]
        const marker = override !== undefined ? "*" : " "
        const active = i === cursor
        const label = k.aliases[0]!.padEnd(Math.max(8, keyColWidth - 2))
        return (
          <Text key={k.jsonName} color={active ? "cyan" : undefined} backgroundColor="black" wrap="truncate-end">
            {active ? "▸" : " "} {label} {String(value).padStart(7)} {marker}  <Text dimColor backgroundColor="black">{k.help}</Text>
          </Text>
        )
      })}
      {countBelow > 0 ? <Text dimColor backgroundColor="black">  ▼ {countBelow} more below</Text> : null}
      <Text backgroundColor="black"> </Text>
      <Text dimColor backgroundColor="black">Recipes  (press ⏎ or 1-9 to apply, s to save, d to delete custom)</Text>
      {recipesList.map((r, i) => {
        const itemIdx = keys.length + i
        const active = itemIdx === cursor
        const hotkeyTag = i < 9 ? `${i + 1}.`.padStart(3) : "   "
        return (
          <Text key={r.name} color={active ? "cyan" : undefined} backgroundColor="black" wrap="truncate-end">
            {active ? "▸" : " "} {hotkeyTag} <Text bold backgroundColor="black">{r.name}</Text>
            <Text color={r.source === "user" ? "magenta" : undefined} backgroundColor="black">
              {r.source === "user" ? " [user]" : " [builtin]"}
            </Text>
            <Text dimColor backgroundColor="black"> {r.description}</Text>
          </Text>
        )
      })}
      <Text backgroundColor="black"> </Text>
      {savingRecipe ? (
        <Text wrap="truncate-end" backgroundColor="black">
          save recipe as: <Text color="cyan" backgroundColor="black">{savingRecipe.buffer || "_"}</Text>  <Text dimColor backgroundColor="black">(⏎ save · esc cancel)</Text>
        </Text>
      ) : edit ? (
        <Text wrap="truncate-end" backgroundColor="black">
          editing <Text bold backgroundColor="black">{edit.jsonName}</Text> = <Text color="cyan" backgroundColor="black">{edit.buffer || "_"}</Text>  <Text dimColor backgroundColor="black">(⏎ save · esc cancel{CYCLABLE_KEYS.includes(edit.jsonName) ? " · ◀/▶ cycle" : ""})</Text>
        </Text>
      ) : (
        <Text dimColor wrap="truncate-end" backgroundColor="black">↑↓ nav · ⏎ edit/apply · s save recipe · y copy audit · u unset · c clear{isMlx ? " · v flavor" : ""} · esc close</Text>
      )}
      {notice ? <Text color="yellow" wrap="truncate-end" backgroundColor="black">{notice}</Text> : null}
    </Box>
  )
}
