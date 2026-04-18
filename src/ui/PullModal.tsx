import React, { useEffect, useRef, useState } from "react"
import { Box, Text, useInput } from "ink"
import { pull } from "../pull/hf.js"
import { PullAbortedError } from "../pull/download.js"

export interface PullModalProps {
  onDone: (message: string) => void
  onCancel: () => void
  // When set, pre-fills the repo field and starts the download
  // immediately, skipping the repo/file prompts. Used by the empty-
  // state suggestions picker so `⏎` on a starter model goes straight
  // to "running".
  initialRepo?: string
  initialFile?: string
}

export const PullModal: React.FC<PullModalProps> = ({
  onDone, onCancel, initialRepo, initialFile
}) => {
  const [repo, setRepo] = useState(initialRepo ?? "")
  const [file, setFile] = useState(initialFile ?? "")
  const [stage, setStage] = useState<"repo" | "file" | "running">(
    initialRepo ? "running" : "repo"
  )
  const [lines, setLines] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  // If the modal unmounts while a pull is in flight (parent forces a
  // mode change, app quit, etc.) abort so the hf child is SIGTERMed
  // instead of being left orphaned.
  useEffect(() => () => { abortRef.current?.abort() }, [])

  function startPull(r: string, f: string | undefined): void {
    setStage("running")
    const ctl = new AbortController()
    abortRef.current = ctl
    pull({
      repo: r,
      file: f,
      signal: ctl.signal,
      onLine: l => setLines(prev => {
        if (prev.length > 0 && prev[prev.length - 1] === l) return prev
        return [...prev.slice(-8), l]
      })
    })
      .then(res => onDone(`pulled ${res.entry.slug} (port ${res.entry.port})`))
      .catch(err => {
        if (err instanceof PullAbortedError) onDone("pull cancelled")
        else onDone(`pull failed: ${err.message ?? err}`)
      })
  }

  // Auto-start the download when the modal is opened with a prefill.
  useEffect(() => {
    if (initialRepo) startPull(initialRepo, initialFile?.trim() || undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        startPull(repo.trim(), file.trim() || undefined)
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
