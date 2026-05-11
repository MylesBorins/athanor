export function parsePromptCacheBytes(input: unknown): number | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) {
      throw new Error(`expected promptCacheBytes to be a non-negative number, got ${String(input)}`)
    }
    return Math.floor(input)
  }
  if (typeof input !== "string") {
    throw new Error(`expected promptCacheBytes to be a number or string, got ${typeof input}`)
  }

  const s = input.trim().toLowerCase()
  if (s.length === 0) throw new Error("expected promptCacheBytes to be non-empty")

  // Numeric fallback (assume bytes)
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return Math.floor(n)
  }

  // Units: kb/mb/gb (strict)
  const m = s.match(/^(\d+)(kb|mb|gb)$/)
  if (!m) {
    throw new Error(
      `invalid promptCacheBytes "${input}" (expected like "8gb", "512mb", or a bytes number)`
    )
  }

  const n = Number(m[1])
  const unit = m[2]
  const factor = unit === "kb" ? 1024 : unit === "mb" ? 1024 ** 2 : 1024 ** 3
  return Math.floor(n * factor)
}
