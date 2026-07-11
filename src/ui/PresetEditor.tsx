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
  unsetPresetFields,
  KeySpec
} from "../presets/edit.js"
import { listRecipes, recipeToPreset } from "../presets/recipes.js"

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

export const PresetEditor: React.FC<PresetEditorProps> = ({
  entryId,
  width = 88,
  onClose
}) => {
  const initial = getModel(entryId)
  const [entry, setEntry] = useState<ModelEntry | undefined>(initial)
  const [cursor, setCursor] = useState(0)
  const [edit, setEdit] = useState<EditState>(null)
  const [notice, setNotice] = useState("")

  const keys = useMemo(() => entry ? listKeys(entry.runtime) : [], [entry])
  const recipes = useMemo(() => listRecipes(), [])
  const effective = useMemo(
    () => entry ? (mergedConfigFor(entry) as unknown as Record<string, string | number>) : {},
    [entry]
  )

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
      if (key.backspace || key.delete) {
        setEdit(e => e ? { ...e, buffer: e.buffer.slice(0, -1) } : e)
        return
      }
      const spec = keys.find(k => k.jsonName === edit.jsonName)
      const isStringField = spec?.type === "string"
      if (input) {
        const allowed = isStringField ? /^[a-zA-Z0-9_\-\.\/:]$/ : /^[0-9.-]$/
        if (allowed.test(input)) {
          setEdit(e => e ? { ...e, buffer: e.buffer + input } : e)
        }
      }
      return
    }

    if (key.escape) { onClose(notice); return }
    if (key.downArrow) setCursor(c => Math.min(keys.length - 1, c + 1))
    else if (key.upArrow) setCursor(c => Math.max(0, c - 1))
    else if (key.return) {
      const spec = keys[cursor]
      if (spec) {
        const existing = presetValueFor(entry, spec.jsonName)
        const start = existing !== undefined ? String(existing) : String(effective[spec.jsonName] ?? "")
        setEdit({ jsonName: spec.jsonName, buffer: start })
      }
    }
    else if (input === "u") {
      const spec = keys[cursor]
      if (!spec) return
      try {
        const preset = unsetPresetFields(entry, [spec.jsonName])
        persistPreset(preset, `unset ${spec.jsonName}`)
      } catch (err) { setNotice(`error: ${errMsg(err)}`) }
    }
    else if (input === "c") { persistPreset(undefined, "preset cleared") }
    else if (input === "v" && entry.runtime === "mlx") {
      // Toggle MLX flavor (lm <-> vlm). Mirrors cmdFlavor: warn when
      // flipping to vlm on a model that has no detected vision tower,
      // and append a restart hint when the model is currently running
      // since the change only takes effect on a fresh spawn.
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
      const r = recipes[idx]
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

  // For MLX entries, surface the active server explicitly (lm vs vlm)
  // and flag the underlying vision capability when present so the user
  // knows whether `v` will succeed.
  const isMlx     = entry.runtime === "mlx"
  const isVlm     = isMlx && entry.mlxFlavor === "vlm"
  const hasVlmCap = isMlx && (entry.mlxCapabilities ?? []).includes("vlm")
  const runtimeLabel = isMlx ? `mlx-${entry.mlxFlavor ?? "lm"}` : entry.runtime

  const innerWidth = Math.max(24, width - 4)
  const keyColWidth = 22
  const valueColWidth = Math.max(8, innerWidth - keyColWidth - 7)

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
      <Text dimColor backgroundColor="black">Tunable keys  (override marked with *)</Text>
      {keys.map((k, i) => {
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
      <Text backgroundColor="black"> </Text>
      <Text dimColor backgroundColor="black">Recipes  (1-9 applies)</Text>
      {recipes.slice(0, 9).map((r, i) => (
        <Text key={r.name} backgroundColor="black" wrap="truncate-end">
          {`${i + 1}.`.padStart(3)} <Text bold backgroundColor="black">{r.name}</Text>
          <Text color={r.source === "user" ? "magenta" : undefined} backgroundColor="black">
            {r.source === "user" ? " [user]" : " [builtin]"}
          </Text>
          <Text dimColor backgroundColor="black"> {r.description}</Text>
        </Text>
      ))}
      <Text backgroundColor="black"> </Text>
      {edit
        ? <Text wrap="truncate-end" backgroundColor="black">editing <Text bold backgroundColor="black">{edit.jsonName}</Text> = <Text color="cyan" backgroundColor="black">{edit.buffer || "_"}</Text>  <Text dimColor backgroundColor="black">(⏎ save · esc cancel)</Text></Text>
        : <Text dimColor wrap="truncate-end" backgroundColor="black">↑↓ nav · ⏎ edit · u unset · c clear{isMlx ? " · v flavor" : ""} · 1-9 recipe · esc close</Text>}
      {notice ? <Text color="yellow" wrap="truncate-end" backgroundColor="black">{notice}</Text> : null}
    </Box>
  )
}
