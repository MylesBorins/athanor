import type { ModelEntry, RuntimeType } from "../types/index.js"

function expectedRuntimeModelId(entry: ModelEntry): string {
  if (entry.runtime === "mlx") {
    return entry.source.type === "hf" ? entry.source.repo : entry.path
  }
  return entry.piAlias ?? entry.slug
}

export function healthUrl(runtime: RuntimeType, port: number): string {
  switch (runtime) {
    case "llama.cpp":
      return `http://127.0.0.1:${port}/health`
    case "mlx":
      return `http://127.0.0.1:${port}/v1/models`
  }
}

export async function probeHealth(
  runtime: RuntimeType,
  port: number,
  timeoutMs = 1500
): Promise<boolean> {
  const url = healthUrl(runtime, port)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return false
    if (runtime === "llama.cpp") {
      const body = await res.json().catch(() => null) as { status?: string } | null
      if (body && typeof body.status === "string") {
        return body.status === "ok"
      }
      return true
    }
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function waitForHealthy(
  runtime: RuntimeType,
  port: number,
  opts: { timeoutMs: number; intervalMs: number; abort?: AbortSignal }
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs
  while (Date.now() < deadline) {
    if (opts.abort?.aborted) throw new Error("aborted")
    if (await probeHealth(runtime, port, opts.intervalMs)) return
    await new Promise(r => setTimeout(r, opts.intervalMs))
  }
  throw new Error(
    `${runtime} did not become healthy on port ${port} within ${opts.timeoutMs}ms`
  )
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function probeRuntimeModelId(entry: ModelEntry, timeoutMs = 1500): Promise<boolean> {
  const body = await fetchJson(`http://127.0.0.1:${entry.port}/v1/models`, timeoutMs) as
    | { data?: Array<{ id?: unknown }> }
    | null
  if (!body || !Array.isArray(body.data)) return false
  const expected = expectedRuntimeModelId(entry)
  return body.data.some(model => typeof model?.id === "string" && model.id === expected)
}
