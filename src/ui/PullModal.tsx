import React, { useEffect, useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import { pull } from "../pull/hf.js"
import { PullAbortedError } from "../pull/download.js"

export interface PullModalProps {
  onDone: (message: string) => void
  onCancel: () => void
}

export const PullModal: React.FC<PullModalProps> = ({ onDone, onCancel }) => {
  const [repo, setRepo] = useState("")
  const [file, setFile] = useState("")
  const [stage, setStage] = useState<"repo" | "file" | "running">("repo")
  const [lines, setLines] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // If the modal unmounts while a pull is in flight (parent forces a
  // mode change, app quit, etc.) abort so the hf child is SIGTERMed
  // instead of being left orphaned.
  useEffect(() => () => { abortRef.current?.abort() }, [])

  useInput((input, key) => {
    if (stage === "running") {
      if (key.escape) { abortRef.current?.abort() }
      return
    }
    if (key.escape) return onCancel()
    if (key.return) {
      if (stage === "repo") {
        if (!repo.trim()) return
        setStage("file")
        return
      }
      if (stage === "file") {
        setStage("running")
        const ctl = new AbortController()
        abortRef.current = ctl
        pull({
          repo: repo.trim(),
          file: file.trim() || undefined,
          signal: ctl.signal,
          onLine: l => setLines(prev => {
            if (prev.length > 0 && prev[prev.length - 1] === l) return prev
            return [...prev.slice(-8), l]
          })
        })
          .then(r => onDone(`pulled ${r.entry.slug} (port ${r.entry.port})`))
          .catch(err => {
            if (err instanceof PullAbortedError) onDone("pull cancelled")
            else onDone(`pull failed: ${err.message ?? err}`)
          })
        return
      }
    }
    if (key.backspace || key.delete) {
      if (stage === "repo") setRepo(r => r.slice(0, -1))
      else if (stage === "file") setFile(f => f.slice(0, -1))
      return
    }
    if (input && !key.ctrl && !key.meta) {
      if (stage === "repo") setRepo(r => r + input)
      else if (stage === "file") setFile(f => f + input)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text bold>Pull from HuggingFace</Text>
      <Box marginTop={1}>
        <Text>repo:  </Text>
        <Text color={stage === "repo" ? "cyan" : undefined}>{repo || "<org>/<name>"}</Text>
      </Box>
      <Box>
        <Text>file:  </Text>
        <Text color={stage === "file" ? "cyan" : undefined}>{file || "(blank = auto)"}</Text>
      </Box>
      {stage === "running" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>downloading…</Text>
          {lines.map((l, i) => <Text key={i} dimColor>{l}</Text>)}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>⏎ next/start · esc cancel</Text>
      </Box>
    </Box>
  )
}
