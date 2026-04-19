import type { RuntimeType } from "../types/index.js"

// Hub model search. Reference:
// https://huggingface.co/docs/hub/api#get-apimodels
// Relevant query parameters: search, author, filter (tag), sort,
// direction, limit. The `filter` parameter is tag-based: "mlx" and
// "gguf" are both widely-applied tags on the Hub.

export type SearchFilter = "mlx" | "gguf" | "any"
export type SearchSort = "downloads" | "likes" | "trending" | "modified"

export interface SearchOpts {
  query?: string
  filter?: SearchFilter
  author?: string
  sort?: SearchSort
  limit?: number
}

export interface SearchResult {
  id: string
  downloads?: number
  likes?: number
  lastModified?: string
  tags: string[]
  runtime?: RuntimeType
  license?: string
}

const API = "https://huggingface.co/api/models"

function sortParam(sort: SearchSort): string {
  switch (sort) {
    case "downloads": return "downloads"
    case "likes":     return "likes"
    case "trending":  return "trendingScore"
    case "modified":  return "lastModified"
  }
}

function extractLicense(tags: string[]): string | undefined {
  const t = tags.find(x => x.startsWith("license:"))
  return t ? t.slice("license:".length) : undefined
}

function runtimeFromTags(id: string, tags: string[]): RuntimeType | undefined {
  if (tags.includes("gguf")) return "llama.cpp"
  if (tags.includes("mlx")) return "mlx"
  if (/\bmlx\b/i.test(id)) return "mlx"
  if (/\bgguf\b/i.test(id)) return "llama.cpp"
  return undefined
}

function parse(body: unknown): SearchResult[] {
  if (!Array.isArray(body)) return []
  return body.map((raw): SearchResult => {
    const b = raw as Record<string, unknown>
    const tags = Array.isArray(b.tags) ? (b.tags as string[]) : []
    return {
      id: String(b.id ?? b.modelId ?? ""),
      downloads: typeof b.downloads === "number" ? b.downloads : undefined,
      likes: typeof b.likes === "number" ? b.likes : undefined,
      lastModified: typeof b.lastModified === "string" ? b.lastModified : undefined,
      tags,
      runtime: runtimeFromTags(String(b.id ?? ""), tags),
      license: extractLicense(tags)
    }
  }).filter(r => r.id.length > 0)
}

async function queryOne(filterTag: string | null, opts: SearchOpts): Promise<SearchResult[]> {
  const params = new URLSearchParams()
  if (opts.query)  params.set("search", opts.query)
  if (opts.author) params.set("author", opts.author)
  if (filterTag)   params.set("filter", filterTag)
  params.set("sort", sortParam(opts.sort ?? "downloads"))
  params.set("direction", "-1")
  params.set("limit", String(opts.limit ?? 20))
  const url = `${API}?${params.toString()}`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`HF search ${res.status} for ${url}`)
  return parse(await res.json())
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const r of results) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}

// Runs one or two API calls depending on the filter, de-dupes, and
// returns results ordered with the primary sort key descending.
export async function searchModels(opts: SearchOpts = {}): Promise<SearchResult[]> {
  const filter = opts.filter ?? "any"
  if (filter === "mlx")  return queryOne("mlx",  opts)
  if (filter === "gguf") return queryOne("gguf", opts)
  const [mlx, gguf] = await Promise.all([
    queryOne("mlx",  opts),
    queryOne("gguf", opts)
  ])
  // Interleave and dedupe. Preserve per-query order (which the API
  // already sorted for us).
  const merged: SearchResult[] = []
  const max = Math.max(mlx.length, gguf.length)
  for (let i = 0; i < max; i++) {
    if (mlx[i]) merged.push(mlx[i])
    if (gguf[i]) merged.push(gguf[i])
  }
  return dedupe(merged).slice(0, opts.limit ?? 20)
}

export function groupByRuntime(results: SearchResult[]): {
  mlx: SearchResult[]
  gguf: SearchResult[]
  other: SearchResult[]
} {
  const mlx: SearchResult[] = []
  const gguf: SearchResult[] = []
  const other: SearchResult[] = []
  for (const r of results) {
    if (r.runtime === "mlx") mlx.push(r)
    else if (r.runtime === "llama.cpp") gguf.push(r)
    else other.push(r)
  }
  return { mlx, gguf, other }
}
