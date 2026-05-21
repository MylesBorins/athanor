/**
 * CLI snippet templates and OpenAI API generation is inspired by whichllm
 * under the MIT License:
 * Copyright (c) 2026 Andyyyy64
 * https://github.com/Andyyyy64/whichllm
 */

import { getModel } from "../registry/index.js"
import { mergedConfigFor, runtimeModelId } from "../adapters/index.js"
import { style } from "./style.js"
import { head, dim } from "./shared.js"
import { loadConfig } from "../config/index.js"
import type { LlamaConfig, MlxConfig } from "../types/index.js"

export function cmdSnippet(idOrSlug: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) {
    console.error(`${style.red("✗")} unknown model: ${style.bold(idOrSlug)}`)
    process.exit(1)
  }

  const modelId = runtimeModelId(entry)
  const port = entry.port
  const slug = entry.slug
  const runtime = entry.runtime

  const config = loadConfig()
  const routerEnabled = config.router.enabled
  const routerPort = config.router.port
  const routerHost = config.router.host

  const merged = mergedConfigFor(entry)
  let contextWindow = 4096
  if (entry.runtime === "mlx") {
    contextWindow = (merged as MlxConfig).contextWindow ?? 32768
  } else {
    contextWindow = (merged as LlamaConfig).ctxSize ?? 32768
  }

  const url = `http://127.0.0.1:${port}/v1`
  const routerUrl = `http://${routerHost}:${routerPort}/v1`

  head(`integration snippets: ${slug}`)
  console.log()

  // 1. Bash / cURL
  head("cURL (Bash)")
  console.log(style.gray("--------------------------------------------------------------------------------"))
  console.log(`curl ${url}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer athanor" \\
  -d '{
    "model": "${modelId}",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'`)
  console.log(style.gray("--------------------------------------------------------------------------------"))
  console.log()

  // 2. Python
  head("Python (openai SDK)")
  console.log(style.gray("--------------------------------------------------------------------------------"))
  console.log(`from openai import OpenAI

client = OpenAI(
    base_url="${url}",
    api_key="athanor"
)

response = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
print()`)
  console.log(style.gray("--------------------------------------------------------------------------------"))
  console.log()

  // 3. pi-agent
  head("pi-agent custom provider block")
  console.log(style.gray("--------------------------------------------------------------------------------"))
  
  const compat: Record<string, unknown> = {
    supportsReasoningEffort: false
  }
  if (runtime === "mlx") {
    compat.supportsDeveloperRole = false
  }

  const piConfig = {
    providers: {
      [`custom-${slug}`]: {
        baseUrl: url,
        api: "openai-completions",
        apiKey: "athanor",
        compat,
        models: [
          {
            id: modelId,
            name: `[${runtime === "mlx" && entry.mlxFlavor === "vlm" ? "mlx-vlm" : runtime}] ${slug}`,
            input: ["text"],
            contextWindow: contextWindow
          }
        ]
      }
    }
  }
  console.log(JSON.stringify(piConfig, null, 2))
  console.log(style.gray("--------------------------------------------------------------------------------"))
  console.log()

  if (routerEnabled) {
    head("Shared Router (Enabled)")
    console.log(dim(`Note: You can also direct all client integrations to the central router endpoint:`))
    console.log(`  Base URL:  ${style.cyan(routerUrl)}`)
    console.log(`  Model ID:  ${style.cyan(modelId)}`)
    console.log()
  }
}
