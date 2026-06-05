import * as fs from "fs"
import * as os from "os"
import * as path from "path"

// Reads the locally stored Hugging Face token so API requests can
// authenticate and avoid anonymous rate limits (429s).
//
// Resolution order (matches the huggingface_hub Python library):
//   1. HF_TOKEN env var
//   2. HUGGING_FACE_HUB_TOKEN env var (legacy)
//   3. ~/.cache/huggingface/token file
//
// Returns undefined when no token is available — callers fall back to
// unauthenticated requests (which still work, just at lower rate limits).

let cached: string | undefined | null = null

export function readHfToken(): string | undefined {
  if (cached !== null) return cached
  cached = resolve()
  return cached
}

function resolve(): string | undefined {
  const envToken = process.env.HF_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN
  if (envToken) return envToken.trim() || undefined

  const tokenPath = path.join(os.homedir(), ".cache", "huggingface", "token")
  try {
    const content = fs.readFileSync(tokenPath, "utf8").trim()
    return content || undefined
  } catch {
    return undefined
  }
}

// Returns headers suitable for spreading into a fetch() call.
// Always includes Accept: application/json; adds Authorization
// when a token is available.
export function hfHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" }
  const token = readHfToken()
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

// Allow tests to reset the cached token.
export function _resetTokenCache(): void {
  cached = null
}
