import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { ModelEntry } from "../types/index.js"
import { getModel } from "../registry/index.js"
import { mergedConfigFor } from "../adapters/index.js"
import { supervisor } from "../supervisor/index.js"
import { setFlavor, setFormula } from "../app/models.js"
import {
  listKeys,
  setFormulaFields,
  unsetFormulaFields
} from "../presets/edit.js"
import {
  COMPOUND_KNOBS,
  getCategoriesForRuntime,
  inferCompoundState,
  applyCompoundSelection,
  type CompoundKnob
} from "../presets/compound.js"
import {
  deleteUserFormula,
  findMatchingFormula,
  listFormulas,
  formulaToRuntime,
  saveUserFormula,
  type Formula
} from "../presets/recipes.js"
import { copyToClipboard, formatPresetCopyText } from "./clipboard.js"

export interface PresetEditorProps {
  entryId: string
  width?: number
  onClose: (message: string) => void
}

// In-memory value for the key currently being edited. Kept separate
// from the saved formula so Esc cleanly discards.
type EditState = { jsonName: string; buffer: string } | null

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function presetValueFor(entry: ModelEntry, jsonName: string): string | number | undefined {
  const active = entry.formula ?? entry.preset
  if (!active || active.runtime !== entry.runtime) return undefined
  const bag = active.runtime === "mlx" ? active.mlx : active.llama
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
  "speculativeMode",
  "reasoningEffort"
]

export const PresetEditor: React.FC<PresetEditorProps> = ({
  entryId,
  width = 88,
  onClose
}) => {
  const initial = getModel(entryId)
  const [entry, setEntry] = useState<ModelEntry | undefined>(initial)
  const [mode, setMode] = useState<"simple" | "advanced">("simple")
  const [cursor, setCursor] = useState(0)
  const [edit, setEdit] = useState<EditState>(null)
  const [activeRecipeName, setActiveRecipeName] = useState<string | null>(null)
  const [savingRecipe, setSavingRecipe] = useState<{ buffer: string; cycleIndex: number } | null>(null)
  const [recipesList, setRecipesList] = useState<Formula[]>(() => listFormulas())
  const [notice, setNotice] = useState("")
  const [clearConfirmPending, setClearConfirmPending] = useState(false)

  // Reset clear confirmation after 3 seconds
  useEffect(() => {
    if (!clearConfirmPending) return
    const timer = setTimeout(() => {
      setClearConfirmPending(false)
      setNotice("")
    }, 3000)
    return () => clearTimeout(timer)
  }, [clearConfirmPending])

  const compoundKnobs = useMemo(() => {
    if (!entry) return []
    return COMPOUND_KNOBS.filter(k => {
      if (!k.runtimes.includes(entry.runtime)) return false
      if (k.id === "reasoningEffort" && !entry.reasoningEffort) return false
      return true
    })
  }, [entry])

  const categories = useMemo(() => {
    if (!entry) return []
    return getCategoriesForRuntime(entry.runtime)
  }, [entry])

  const allKeys = useMemo(() => (entry ? listKeys(entry.runtime) : []), [entry])

  const effective = useMemo(
    () => (entry ? (mergedConfigFor(entry) as unknown as Record<string, string | number>) : {}),
    [entry]
  )

  const compoundState = useMemo(() => {
    if (!entry) return {}
    return inferCompoundState(entry, effective)
  }, [entry, effective])

  // In Advanced mode, flat items represent all tunable keys
  const totalItems = mode === "simple" ? compoundKnobs.length : allKeys.length

  function refresh(msg: string): void {
    setEntry(getModel(entryId))
    setNotice(msg)
  }

  function persistPreset(formula: ModelEntry["formula"], msg: string): void {
    setFormula(entryId, formula)
    refresh(msg)
  }

  function persistFlavor(mlxFlavor: ModelEntry["mlxFlavor"], msg: string): void {
    setFlavor(entryId, mlxFlavor)
    refresh(msg)
  }

  useInput((input, key) => {
    if (!entry) {
      if (key.escape) onClose("")
      return
    }

    // Tab key toggles between Simple and Advanced modes
    if (key.tab) {
      setMode(m => (m === "simple" ? "advanced" : "simple"))
      setCursor(0)
      setEdit(null)
      return
    }

    if (savingRecipe) {
      if (key.escape) {
        setSavingRecipe(null)
        return
      }
      if (key.return) {
        const name = savingRecipe.buffer.trim()
        if (!name) {
          setNotice("error: formula name cannot be empty")
          return
        }
        const active = entry.formula ?? entry.preset
        const formula: Formula = {
          name,
          description: `Custom formula saved from ${entry.slug}`,
          mlx: active?.runtime === "mlx" ? active.mlx : undefined,
          llama: active?.runtime === "llama.cpp" ? active.llama : undefined,
          source: "user"
        }
        saveUserFormula(formula)
        setRecipesList(listFormulas())
        setActiveRecipeName(name)
        setSavingRecipe(null)
        setNotice(`✓ formula "${name}" saved`)
        return
      }
      if (key.upArrow || key.downArrow) {
        const dir = key.upArrow ? -1 : 1
        const allNames = recipesList.map(r => r.name)
        if (allNames.length > 0) {
          const nextIdx = (savingRecipe.cycleIndex + dir + allNames.length) % allNames.length
          const nextName = allNames[nextIdx]!
          setSavingRecipe({ buffer: nextName, cycleIndex: nextIdx })
        }
        return
      }
      if (key.tab) {
        const prefix = savingRecipe.buffer.trim().toLowerCase()
        if (prefix) {
          const match = recipesList.find(
            r => r.name.toLowerCase().startsWith(prefix) && r.name.toLowerCase() !== prefix
          )
          if (match) {
            const idx = recipesList.indexOf(match)
            setSavingRecipe({ buffer: match.name, cycleIndex: idx >= 0 ? idx : 0 })
          }
        }
        return
      }
      if (key.backspace || key.delete) {
        setSavingRecipe(s => (s ? { ...s, buffer: s.buffer.slice(0, -1) } : s))
        return
      }
      if (input && /^[a-zA-Z0-9_-]$/.test(input)) {
        setSavingRecipe(s => (s ? { ...s, buffer: s.buffer + input } : s))
      }
      return
    }

    if (edit) {
      if (key.escape) {
        setEdit(null)
        return
      }
      if (key.return) {
        try {
          const formula = setFormulaFields(entry, [[edit.jsonName, edit.buffer]])
          persistPreset(formula, `updated ${edit.jsonName} = ${edit.buffer}`)
          setEdit(null)
        } catch (err) {
          setNotice(`error: ${errMsg(err)}`)
        }
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
        } else if (edit.jsonName === "reasoningEffort") {
          const options = entry.reasoningEffort?.enum ?? ["xhigh", "medium", "low"]
          const idx = options.indexOf(edit.buffer)
          if (idx < 0) {
            nextVal = dir === "left" ? options[options.length - 1] : options[0]
          } else {
            nextVal = dir === "left" ? options[Math.max(0, idx - 1)] : options[Math.min(options.length - 1, idx + 1)]
          }
        }

        if (nextVal !== undefined) {
          setEdit(e => (e ? { ...e, buffer: String(nextVal) } : e))
          return
        }
      }
      if (key.backspace || key.delete) {
        setEdit(e => (e ? { ...e, buffer: e.buffer.slice(0, -1) } : e))
        return
      }
      const spec = allKeys.find(k => k.jsonName === edit.jsonName)
      const isStringField = spec?.type === "string"
      if (input) {
        const allowed = isStringField ? /^[a-zA-Z0-9_\-./:]$/ : /^[0-9.-]$/
        if (allowed.test(input)) {
          setEdit(e => (e ? { ...e, buffer: e.buffer + input } : e))
        }
      }
      return
    }

    if (key.escape) {
      onClose(notice)
      return
    }

    // Up / Down navigation
    if (key.downArrow) {
      setCursor(c => Math.min(totalItems - 1, c + 1))
      return
    }
    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1))
      return
    }

    // SIMPLE MODE: Left/Right directly cycles compound options
    if (mode === "simple") {
      const knob = compoundKnobs[cursor]
      if (knob && (key.leftArrow || key.rightArrow)) {
        const dir = key.leftArrow ? "left" : "right"
        const currentVal = compoundState[knob.id]
        const optKeys = knob.options.map(o => o.key)
        const curIdx = optKeys.indexOf(currentVal ?? "")
        let nextIdx = 0
        if (curIdx >= 0) {
          nextIdx = dir === "left" ? Math.max(0, curIdx - 1) : Math.min(optKeys.length - 1, curIdx + 1)
        } else {
          nextIdx = dir === "left" ? 0 : optKeys.length - 1
        }
        const nextOption = knob.options[nextIdx]
        if (nextOption) {
          const updated = applyCompoundSelection(entry, knob.id, nextOption.key)
          persistPreset(updated, `${knob.label} → ${nextOption.label}`)
        }
        return
      }

      if (key.return && knob) {
        // Open edit buffer for custom input on context or GPU
        if (knob.id === "contextWindow") {
          const field = entry.runtime === "mlx" ? "contextWindow" : "ctxSize"
          setEdit({ jsonName: field, buffer: String(effective[field] ?? "") })
        } else if (knob.id === "gpuOffload") {
          setEdit({ jsonName: "nGpuLayers", buffer: String(effective.nGpuLayers ?? "") })
        }
        return
      }
    }

    // ADVANCED MODE: Enter opens buffer
    if (mode === "advanced") {
      if (cursor < allKeys.length) {
        const spec = allKeys[cursor]
        if (spec && key.return) {
          const existing = presetValueFor(entry, spec.jsonName)
          const start = existing !== undefined ? String(existing) : String(effective[spec.jsonName] ?? "")
          setEdit({ jsonName: spec.jsonName, buffer: start })
          return
        }
      }
    }

    // Dedicated hotkeys
    if (input === "s") {
      const matching = findMatchingFormula(entry, recipesList)
      const initialName =
        activeRecipeName ||
        matching?.name ||
        (recipesList.find(r => r.source === "user")?.name ?? `${entry.slug}-custom`)
      const initialIdx = recipesList.findIndex(r => r.name === initialName)
      setSavingRecipe({ buffer: initialName, cycleIndex: initialIdx >= 0 ? initialIdx : 0 })
      return
    }
    if (input === "y") {
      const textToCopy = formatPresetCopyText(entry, effective)
      const ok = copyToClipboard(textToCopy)
      if (ok) {
        setNotice("✓ copied configuration & command to clipboard!")
      } else {
        setNotice("error: unable to access system clipboard")
      }
      return
    }

    // Two-tap confirm for 'c' (clear formula)
    if (input === "c") {
      if (clearConfirmPending) {
        persistPreset(undefined, "formula cleared")
        setActiveRecipeName(null)
        setClearConfirmPending(false)
      } else {
        setClearConfirmPending(true)
        setNotice("⚠ press 'c' again within 3s to confirm clearing formula")
      }
      return
    }
    if (input === "d") {
      const customFormulas = recipesList.filter(r => r.source === "user")
      const targetName = activeRecipeName || customFormulas[0]?.name
      if (targetName && deleteUserFormula(targetName)) {
        setRecipesList(listFormulas())
        setActiveRecipeName(null)
        setNotice(`✓ formula "${targetName}" deleted`)
      } else {
        setNotice("error: no custom formula found to delete")
      }
      return
    }
    // Any other key resets clear confirmation
    if (clearConfirmPending) {
      setClearConfirmPending(false)
    }

    if (input === "u") {
      if (mode === "advanced" && cursor < allKeys.length) {
        const spec = allKeys[cursor]
        if (!spec) return
        try {
          const formula = unsetFormulaFields(entry, [spec.jsonName])
          persistPreset(formula, `unset ${spec.jsonName}`)
        } catch (err) {
          setNotice(`error: ${errMsg(err)}`)
        }
      } else if (mode === "simple") {
        const knob = compoundKnobs[cursor]
        if (knob?.id === "kvCache") {
          const formula = unsetFormulaFields(entry, ["cacheTypeK", "cacheTypeV"])
          persistPreset(formula, "reset KV cache to defaults")
        } else if (knob?.id === "speculative") {
          const formula = unsetFormulaFields(entry, ["speculativeMode", "specType", "specDraftNgl", "specDraftModel"])
          persistPreset(formula, "reset speculative decoding to defaults")
        }
      }
      return
    }

    if (input === "v" && entry.runtime === "mlx") {
      const next = entry.mlxFlavor === "vlm" ? "lm" : "vlm"
      const noVlmCap = !(entry.mlxCapabilities ?? []).includes("vlm")
      const running = supervisor.list().some(i => i.id === entry.id)
      const warn =
        next === "vlm" && noVlmCap ? " · ⚠ no vision tower detected, mlx_vlm.server may fail to load" : ""
      const restart = running ? " · restart to apply" : ""
      persistFlavor(next, `flavor → mlx-${next}${warn}${restart}`)
      return
    }

    // Number hotkeys 1-7 apply formulas immediately
    if (input && /^[1-7]$/.test(input)) {
      const idx = Number(input) - 1
      const r = recipesList[idx]
      if (r) {
        const formula = formulaToRuntime(r, entry.runtime)
        persistPreset(formula, `formula: ${r.name}`)
        setActiveRecipeName(r.name)
      }
    }
  })

  if (!entry) {
    return (
      <Box
        width={width}
        flexDirection="column"
        borderStyle="round"
        borderColor="red"
        padding={1}
        backgroundColor="black"
      >
        <Text color="red" backgroundColor="black">
          model not found
        </Text>
      </Box>
    )
  }

  const isMlx = entry.runtime === "mlx"
  const isVlm = isMlx && entry.mlxFlavor === "vlm"
  const hasVlmCap = isMlx && (entry.mlxCapabilities ?? []).includes("vlm")
  const runtimeLabel = isMlx ? `mlx-${entry.mlxFlavor ?? "lm"}` : entry.runtime
  const keyColWidth = 22

  // Advanced mode scrolling
  const MAX_VISIBLE_KEYS = 8
  const activeKeyCursor = Math.min(cursor, allKeys.length - 1)
  const windowStart = Math.max(
    0,
    Math.min(activeKeyCursor - Math.floor(MAX_VISIBLE_KEYS / 2), allKeys.length - MAX_VISIBLE_KEYS)
  )
  const windowEnd = Math.min(allKeys.length, windowStart + MAX_VISIBLE_KEYS)
  const visibleKeys = allKeys.slice(windowStart, windowEnd)
  const countAbove = windowStart
  const countBelow = allKeys.length - windowEnd

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      padding={1}
      backgroundColor="black"
    >
      <Box justifyContent="space-between">
        <Text bold color="cyan" backgroundColor="black">
          Formula editor {mode === "advanced" ? "[ADVANCED]" : "[SIMPLE]"}
        </Text>
        <Text dimColor backgroundColor="black">
          [Tab] {mode === "simple" ? "Switch to Advanced" : "Switch to Simple"}
        </Text>
      </Box>

      <Text wrap="truncate-end" backgroundColor="black">
        <Text backgroundColor="black">{entry.slug} </Text>
        <Text dimColor backgroundColor="black">
          ({runtimeLabel})
        </Text>
      </Text>
      {isMlx && hasVlmCap && !isVlm ? (
        <Text dimColor wrap="truncate-end" backgroundColor="black">
          vision tower detected — press{" "}
          <Text bold color="cyan" backgroundColor="black">
            v
          </Text>{" "}
          to switch to mlx-vlm
        </Text>
      ) : null}

      <Text backgroundColor="black"> </Text>

      {/* SIMPLE MODE VIEW */}
      {mode === "simple" ? (
        <Box flexDirection="column">
          <Text dimColor backgroundColor="black">
            Smart controls  (◀ / ▶ to cycle, ⏎ to edit custom value)
          </Text>
          <Text backgroundColor="black"> </Text>
          {compoundKnobs.map((knob, idx) => {
            const active = idx === cursor
            const currentKey = compoundState[knob.id]
            return (
              <Box key={knob.id} flexDirection="row" marginBottom={0}>
                <Text color={active ? "cyan" : undefined} backgroundColor="black">
                  {active ? "▸" : " "} <Text bold={active}>{knob.label.padEnd(16)}</Text>
                </Text>
                <Text backgroundColor="black"> ◀  </Text>
                {knob.options.map((opt, optIdx) => {
                  const isSelected = currentKey === opt.key
                  return (
                    <Text key={opt.key} backgroundColor="black">
                      {optIdx > 0 ? " · " : ""}
                      {isSelected ? (
                        <Text bold color="cyan" backgroundColor="black">
                          [{opt.label}]
                        </Text>
                      ) : (
                        <Text dimColor backgroundColor="black">
                          {opt.label}
                        </Text>
                      )}
                    </Text>
                  )
                })}
                {currentKey === "custom" ? (
                  <Text color="yellow" backgroundColor="black">
                    {" "}· [custom]
                  </Text>
                ) : null}
                <Text backgroundColor="black">  ▶</Text>
              </Box>
            )
          })}
        </Box>
      ) : (
        /* ADVANCED MODE VIEW */
        <Box flexDirection="column">
          <Text dimColor backgroundColor="black">
            Tunable keys (override marked with *){allKeys.length > MAX_VISIBLE_KEYS ? ` · showing ${windowStart + 1}-${windowEnd} of ${allKeys.length}` : ""}
          </Text>
          {countAbove > 0 ? (
            <Text dimColor backgroundColor="black">
              {" "}
              ▲ {countAbove} more above
            </Text>
          ) : null}
          {visibleKeys.map((k, relIndex) => {
            const i = windowStart + relIndex
            const override = presetValueFor(entry, k.jsonName)
            const value = override !== undefined ? override : effective[k.jsonName]
            const marker = override !== undefined ? "*" : " "
            const active = i === cursor
            const label = k.aliases[0]!.padEnd(Math.max(8, keyColWidth - 2))

            // Check if this key starts a category
            const matchingCat = categories.find(c => c.keys[0] === k.jsonName)
            return (
              <Box key={k.jsonName} flexDirection="column">
                {matchingCat ? (
                  <Text bold color="yellow" backgroundColor="black">
                    ▼ {matchingCat.name}
                  </Text>
                ) : null}
                <Text
                  color={active ? "cyan" : undefined}
                  backgroundColor="black"
                  wrap="truncate-end"
                >
                  {active ? "▸" : " "} {label} {String(value).padStart(7)} {marker}  <Text dimColor backgroundColor="black">{k.help}</Text>
                </Text>
              </Box>
            )
          })}
          {countBelow > 0 ? (
            <Text dimColor backgroundColor="black">
              {" "}
              ▼ {countBelow} more below
            </Text>
          ) : null}
        </Box>
      )}

      <Text backgroundColor="black"> </Text>

      {/* FORMULAS BAR */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor backgroundColor="black">
          Formulas (1-7 to apply · s to save custom · d to delete):
        </Text>
        <Text wrap="truncate-end" backgroundColor="black">
          {recipesList.slice(0, 7).map((r, i) => (
            <Text key={r.name} backgroundColor="black">
              {i > 0 ? "  " : ""}
              <Text bold color="cyan" backgroundColor="black">
                {i + 1}.
              </Text>{" "}
              <Text color={r.source === "user" ? "magenta" : undefined} backgroundColor="black">
                {r.name}
              </Text>
            </Text>
          ))}
        </Text>
      </Box>

      <Text backgroundColor="black"> </Text>

      {savingRecipe ? (
        (() => {
          const target = recipesList.find(r => r.name === savingRecipe.buffer.trim())
          const badge =
            target?.source === "user" ? (
              <Text color="magenta" backgroundColor="black">
                {" "}
                [updates user formula]
              </Text>
            ) : target?.source === "builtin" ? (
              <Text color="yellow" backgroundColor="black">
                {" "}
                [overrides builtin]
              </Text>
            ) : (
              <Text color="cyan" backgroundColor="black">
                {" "}
                [new formula]
              </Text>
            )
          return (
            <Text wrap="truncate-end" backgroundColor="black">
              save formula as:{" "}
              <Text bold color="cyan" backgroundColor="black">
                {savingRecipe.buffer || "_"}
              </Text>
              {badge}  <Text dimColor backgroundColor="black">(⏎ save · ↑↓ cycle names · tab complete · esc cancel)</Text>
            </Text>
          )
        })()
      ) : edit ? (
        <Text wrap="truncate-end" backgroundColor="black">
          editing <Text bold backgroundColor="black">{edit.jsonName}</Text> = <Text color="cyan" backgroundColor="black">{edit.buffer || "_"}</Text>  <Text dimColor backgroundColor="black">(⏎ save · esc cancel{CYCLABLE_KEYS.includes(edit.jsonName) ? " · ◀/▶ cycle" : ""})</Text>
        </Text>
      ) : (
        <Text dimColor wrap="truncate-end" backgroundColor="black">
          {mode === "simple" ? "↑↓ select · ◀/▶ cycle · ⏎ custom" : "↑↓ nav · ⏎ edit · u unset"} · Tab {mode === "simple" ? "advanced" : "simple"} · 1-7 formula · s save · y copy · c clear · esc close
        </Text>
      )}
      {notice ? (
        <Text color={notice.startsWith("⚠") ? "yellow" : notice.startsWith("✓") ? "green" : "yellow"} wrap="truncate-end" backgroundColor="black">
          {notice}
        </Text>
      ) : null}
    </Box>
  )
}
