import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { ModelEntry } from "../types/index.js"
import { getModel, updateModel } from "../registry/index.js"
import { mergedConfigFor } from "../adapters/index.js"
import { supervisor } from "../supervisor/index.js"
import { syncPi } from "../sync/pi.js"
import {
  listKeys,
  setPresetFields,
  unsetPresetFields
} from "../presets/edit.js"
import { listRecipes, recipeToPreset } from "../presets/recipes.js"

export interface PresetEditorProps {
  entryId: string
  onClose: (message: string) => void
}

// In-memory value for the key currently being edited. Kept separate
// from the saved preset so Esc cleanly discards.
type EditState = { jsonName: string; buffer: string } | null

function presetValueFor(entry: ModelEntry, jsonName: string): number | undefined {
  if (!entry.preset || entry.preset.runtime !== entry.runtime) return undefined
  const bag = entry.preset.runtime === "mlx" ? entry.preset.mlx : entry.preset.llama
  return (bag as Record<string, number | undefined>)[jsonName]
}

export const PresetEditor: React.FC<PresetEditorProps> = ({ entryId, onClose }) => {
  const initial = getModel(entryId)
  const [entry, setEntry] = useState<ModelEntry | undefined>(initial)
  const [cursor, setCursor] = useState(0)
  const [edit, setEdit] = useState<EditState>(null)
  const [notice, setNotice] = useState("")

  const keys = useMemo(() => entry ? listKeys(entry.runtime) : [], [entry])
  const recipes = useMemo(() => listRecipes(), [])
  const effective = useMemo(
    () => entry ? (mergedConfigFor(entry) as unknown as Record<string, number>) : {},
    [entry]
  )

  function refresh(msg: string): void {
    setEntry(getModel(entryId))
    setNotice(msg)
  }

  function persist(patch: Partial<ModelEntry>, msg: string): void {
    updateModel(entryId, patch)
    syncPi({ instances: supervisor.list() })
    refresh(msg)
  }

  useInput((input, key) => {
    if (!entry) { if (key.escape) onClose(""); return }

    if (edit) {
      if (key.escape) { setEdit(null); return }
      if (key.return) {
        try {
          const preset = setPresetFields(entry, [[edit.jsonName, edit.buffer]])
          persist({ preset }, `set ${edit.jsonName}=${edit.buffer}`)
          setEdit(null)
        } catch (err: any) { setNotice(`error: ${err.message ?? err}`) }
        return
      }
      if (key.backspace || key.delete) {
        setEdit(e => e ? { ...e, buffer: e.buffer.slice(0, -1) } : e)
        return
      }
      if (input && /^[0-9.\-]$/.test(input)) {
        setEdit(e => e ? { ...e, buffer: e.buffer + input } : e)
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
        persist({ preset }, `unset ${spec.jsonName}`)
      } catch (err: any) { setNotice(`error: ${err.message ?? err}`) }
    }
    else if (input === "c") { persist({ preset: undefined }, "preset cleared") }
    else if (input && /^[1-9]$/.test(input)) {
      const idx = Number(input) - 1
      const r = recipes[idx]
      if (!r) return
      const preset = recipeToPreset(r, entry.runtime)
      persist({ preset }, `recipe: ${r.name}`)
    }
  })

  if (!entry) {
    return <Box borderStyle="round" padding={1}><Text color="red">model not found</Text></Box>
  }

  const runtimeLabel = entry.runtime === "mlx" && entry.mlxFlavor === "vlm"
    ? "mlx-vlm" : entry.runtime

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text><Text bold>Preset</Text>: {entry.slug} <Text dimColor>({runtimeLabel})</Text></Text>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Tunable keys  (value · override marked with *)</Text>
        {keys.map((k, i) => {
          const override = presetValueFor(entry, k.jsonName)
          const value = override !== undefined ? override : effective[k.jsonName]
          const marker = override !== undefined ? " *" : "  "
          const active = i === cursor
          const label = k.aliases[0]!.padEnd(20)
          return (
            <Text key={k.jsonName} color={active ? "cyan" : undefined}>
              {active ? "▸ " : "  "}{label} {String(value).padStart(7)}{marker}  <Text dimColor>{k.help}</Text>
            </Text>
          )
        })}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Recipes  (digit applies)</Text>
        {recipes.slice(0, 9).map((r, i) => (
          <Text key={r.name}>
            {"  "}{i + 1}. <Text bold>{r.name.padEnd(14)}</Text>
            <Text color={r.source === "user" ? "magenta" : undefined}>
              {r.source === "user" ? " [user] " : " [builtin] "}
            </Text>
            <Text dimColor>{r.description}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        {edit
          ? <Text>editing <Text bold>{edit.jsonName}</Text> = <Text color="cyan">{edit.buffer || "_"}</Text>  <Text dimColor>(⏎ save · esc cancel)</Text></Text>
          : <Text dimColor>↑↓ nav · ⏎ edit · u unset · c clear · 1-9 recipe · esc close</Text>}
      </Box>
      {notice ? <Text color="yellow">{notice}</Text> : null}
    </Box>
  )
}
