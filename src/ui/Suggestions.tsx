import React from "react"
import { Box, Text } from "ink"
import { SUGGESTIONS } from "../pull/suggestions.js"

export interface SuggestionsProps {
  selectedIndex: number
}

export const Suggestions: React.FC<SuggestionsProps> = ({ selectedIndex }) => {
  return (
    <Box flexDirection="column">
      <Text>Nothing in the registry yet. Pick a starter model to download:</Text>
      <Text> </Text>
      {SUGGESTIONS.map((s, i) => {
        const selected = i === selectedIndex
        const tags = s.taskTags.join(", ")
        return (
          <Box key={s.repo} flexDirection="column">
            <Box>
              <Text color={selected ? "cyan" : undefined}>{selected ? "› " : "  "}</Text>
              <Text bold={selected} color={selected ? "cyan" : undefined}>
                {s.label.padEnd(28)}
              </Text>
              <Text dimColor>{s.sizeLabel.padEnd(10)}</Text>
              <Text dimColor>{s.note}</Text>
            </Box>
            <Box marginLeft={2}>
              <Text dimColor>{`tier ${s.memoryTier.toUpperCase()} · tasks ${tags}`}</Text>
            </Box>
          </Box>
        )
      })}
      <Text> </Text>
      <Text dimColor>
        ⏎ pull highlighted · p custom pull · s scan · q quit
      </Text>
    </Box>
  )
}
