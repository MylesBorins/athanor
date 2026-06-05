import type { RuntimeType } from "../types/index.js"
import { hfHeaders } from "./hf-token.js"

export interface HfSibling {
  rfilename: string
  size?: number
}

export interface HfRepoInfo {
  id: string
  tags?: string[]
  siblings: HfSibling[]
  cardData?: {
    license?: string
    baseModel?: string
  }
  gguf?: {
    architecture?: string
    contextLength?: number
    totalFileSize?: number
  }
}

export interface HfTreeEntry {
  path: string
  type: "file" | "directory"
  size?: number
  lfs?: { size?: number }
}

export async function fetchRepoInfo(repo: string, revision?: string): Promise<HfRepoInfo> {
  const rev = revision ? `/revision/${encodeURIComponent(revision)}` : ""
  const url = `https://huggingface.co/api/models/${repo}${rev}`
  const res = await fetch(url, { headers: hfHeaders() })
  if (!res.ok) throw new Error(`HF API ${res.status} for ${repo}`)
  const body = await res.json() as Record<string, unknown>
  const siblings = Array.isArray(body.siblings)
    ? body.siblings
        .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === "object")
        .map(raw => ({
          rfilename: typeof raw.rfilename === "string" ? raw.rfilename : "",
          size: typeof raw.size === "number" ? raw.size : undefined
        }))
        .filter(s => s.rfilename.length > 0)
    : []
  const cardDataRaw = body.cardData && typeof body.cardData === "object"
    ? body.cardData as Record<string, unknown>
    : undefined
  const ggufRaw = body.gguf && typeof body.gguf === "object"
    ? body.gguf as Record<string, unknown>
    : undefined
  return {
    id: typeof body.id === "string" ? body.id : repo,
    tags: Array.isArray(body.tags) ? body.tags as string[] : [],
    siblings,
    cardData: cardDataRaw
      ? {
          license: typeof cardDataRaw.license === "string" ? cardDataRaw.license : undefined,
          baseModel: typeof cardDataRaw.base_model === "string" ? cardDataRaw.base_model : undefined
        }
      : undefined,
    gguf: ggufRaw
      ? {
          architecture: typeof ggufRaw.architecture === "string" ? ggufRaw.architecture : undefined,
          contextLength: typeof ggufRaw.context_length === "number" ? ggufRaw.context_length : undefined,
          totalFileSize: typeof ggufRaw.totalFileSize === "number"
            ? ggufRaw.totalFileSize
            : typeof ggufRaw.total === "number"
              ? ggufRaw.total
              : undefined
        }
      : undefined
  }
}

export function inferRuntimeFromRepo(info: HfRepoInfo): RuntimeType | undefined {
  const names = info.siblings.map(s => s.rfilename.toLowerCase())
  if (names.some(n => n.endsWith(".gguf"))) return "llama.cpp"
  if (info.tags?.includes("mlx")) return "mlx"
  if (/\bmlx\b/i.test(info.id)) return "mlx"
  if (names.some(n => n.endsWith(".safetensors"))) return "mlx"
  return undefined
}

export async function fetchRepoTree(repo: string, revision = "main", path = ""): Promise<HfTreeEntry[]> {
  const trimmed = path.replace(/^\/+|\/+$/g, "")
  const suffix = trimmed ? `/${trimmed}` : "/"
  const url = `https://huggingface.co/api/models/${repo}/tree/${encodeURIComponent(revision)}${suffix}`
  const res = await fetch(url, { headers: hfHeaders() })
  if (!res.ok) throw new Error(`HF tree ${res.status} for ${repo}`)
  const body = await res.json() as unknown
  if (!Array.isArray(body)) return []
  return body
    .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === "object")
    .map((raw): HfTreeEntry => ({
      path: typeof raw.path === "string" ? raw.path : "",
      type: raw.type === "directory" ? "directory" : "file",
      size: typeof raw.size === "number" ? raw.size : undefined,
      lfs: raw.lfs && typeof raw.lfs === "object"
        ? { size: typeof (raw.lfs as { size?: unknown }).size === "number" ? (raw.lfs as { size?: number }).size : undefined }
        : undefined
    }))
    .filter(entry => entry.path.length > 0)
}

export function listGgufFiles(info: HfRepoInfo): HfSibling[] {
  return info.siblings.filter(s => s.rfilename.toLowerCase().endsWith(".gguf"))
}
