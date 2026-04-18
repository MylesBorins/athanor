import type { RuntimeType } from "../types/index.js"

export interface HfSibling {
  rfilename: string
  size?: number
}

export interface HfRepoInfo {
  id: string
  tags?: string[]
  siblings: HfSibling[]
}

export async function fetchRepoInfo(repo: string, revision?: string): Promise<HfRepoInfo> {
  const rev = revision ? `/revision/${encodeURIComponent(revision)}` : ""
  const url = `https://huggingface.co/api/models/${repo}${rev}`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`HF API ${res.status} for ${repo}`)
  const body = await res.json() as any
  return {
    id: body.id ?? repo,
    tags: Array.isArray(body.tags) ? body.tags : [],
    siblings: Array.isArray(body.siblings) ? body.siblings : []
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

export function listGgufFiles(info: HfRepoInfo): HfSibling[] {
  return info.siblings.filter(s => s.rfilename.toLowerCase().endsWith(".gguf"))
}
