import type { RuntimeType } from "../types/index.js"

// Hub model search. Reference:
// https://huggingface.co/docs/hub/api#get-apimodels
// Relevant query parameters: search, author, filter (tag), sort,
// direction, limit. The `filter` parameter is tag-based: "mlx" and
// "gguf" are both widely-applied tags on the Hub.

export type SearchFilter = "mlx" | "gguf" | "any"
// "size" has no server-side equivalent on the Hub API; we ask the
// server for popularity-ranked candidates and re-sort client-side.
export type SearchSort = "downloads" | "likes" | "trending" | "modified" | "size"

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
  // On-disk size of the model weights in bytes. For GGUF we take
  // gguf.totalFileSize (when the Hub has indexed it); for MLX/
  // safetensors we sum parameters dict × bytes-per-dtype. Undefined
  // for repos the Hub hasn't parsed.
  sizeBytes?: number
}

const API = "https://huggingface.co/api/models"

function sortParam(sort: SearchSort): string {
  switch (sort) {
    case "downloads": return "downloads"
    case "likes":     return "likes"
    case "trending":  return "trendingScore"
    case "modified":  return "lastModified"
    // No server-side size sort. Use downloads to bias toward results
    // that actually carry size metadata, then re-sort in sortBySize.
    case "size":      return "downloads"
  }
}

// Stable client-side sort by sizeBytes descending. Entries without a
// known size (the Hub hasn't indexed safetensors/gguf metadata) sink
// to the bottom rather than disappearing from the result list.
function sortBySize(rs: SearchResult[]): SearchResult[] {
  return [...rs].sort((a, b) => {
    const av = a.sizeBytes ?? -1
    const bv = b.sizeBytes ?? -1
    return bv - av
  })
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

// Bytes-per-element for safetensors dtype names. Missing entries
// contribute 0 to the total, which is safer than guessing for a
// dtype we don't know.
const DTYPE_BYTES: Record<string, number> = {
  F64: 8, I64: 8, U64: 8,
  F32: 4, I32: 4, U32: 4,
  BF16: 2, F16: 2, I16: 2, U16: 2,
  I8: 1, U8: 1, BOOL: 1,
  F8_E4M3: 1, F8_E5M2: 1
}

function sizeFromSafetensors(st: unknown): number | undefined {
  if (!st || typeof st !== "object") return undefined
  const params = (st as { parameters?: unknown }).parameters
  if (!params || typeof params !== "object") return undefined
  let total = 0
  for (const [dtype, count] of Object.entries(params as Record<string, unknown>)) {
    const bytes = DTYPE_BYTES[dtype]
    if (bytes && typeof count === "number") total += bytes * count
  }
  return total > 0 ? total : undefined
}

function sizeFromGguf(gg: unknown): number | undefined {
  if (!gg || typeof gg !== "object") return undefined
  const n = (gg as { totalFileSize?: unknown }).totalFileSize
  return typeof n === "number" && n > 0 ? n : undefined
}

function parse(body: unknown): SearchResult[] {
  if (!Array.isArray(body)) return []
  return body.map((raw): SearchResult => {
    const b = raw as Record<string, unknown>
    const tags = Array.isArray(b.tags) ? (b.tags as string[]) : []
    const sizeBytes = sizeFromGguf(b.gguf) ?? sizeFromSafetensors(b.safetensors)
    return {
      id: String(b.id ?? b.modelId ?? ""),
      downloads: typeof b.downloads === "number" ? b.downloads : undefined,
      likes: typeof b.likes === "number" ? b.likes : undefined,
      lastModified: typeof b.lastModified === "string" ? b.lastModified : undefined,
      tags,
      runtime: runtimeFromTags(String(b.id ?? ""), tags),
      license: extractLicense(tags),
      sizeBytes
    }
  }).filter(r => r.id.length > 0)
}

// HF returns 50 results per page when expand[] is set; sending a
// larger limit is silently capped. Asking for the cap minimizes the
// number of round-trips needed to reach the underlying-biggest models
// the user is scrolling toward.
const PAGE_SIZE = 50

function buildSearchUrl(filterTag: string | null, opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query)  params.set("search", opts.query)
  if (opts.author) params.set("author", opts.author)
  if (filterTag)   params.set("filter", filterTag)
  params.set("sort", sortParam(opts.sort ?? "downloads"))
  params.set("direction", "-1")
  params.set("limit", String(opts.limit ?? PAGE_SIZE))
  // expand[] surfaces per-repo size info: gguf.totalFileSize for
  // llama.cpp repos, safetensors.parameters for MLX/transformers.
  // When any expand[] is set, the API switches to an opt-in shape,
  // so we must also re-request the default fields we rely on.
  for (const field of [
    "gguf", "safetensors",
    "downloads", "likes", "lastModified", "tags"
  ]) params.append("expand[]", field)
  return `${API}?${params.toString()}`
}

// Pulls the rel="next" target out of a Link header. The Hub uses the
// RFC 5988 form `<url>; rel="next", <url>; rel="prev"`.
function parseLinkNext(link: string | null): string | undefined {
  if (!link) return undefined
  for (const part of link.split(",")) {
    const m = part.trim().match(/^<([^>]+)>\s*;\s*rel="?next"?$/)
    if (m) return m[1]
  }
  return undefined
}

async function fetchPage(url: string): Promise<{ results: SearchResult[]; next?: string }> {
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`HF search ${res.status} for ${url}`)
  const results = parse(await res.json())
  const next = parseLinkNext(res.headers.get("link"))
  return { next, results }
}

async function queryOne(filterTag: string | null, opts: SearchOpts): Promise<SearchResult[]> {
  const { results } = await fetchPage(buildSearchUrl(filterTag, opts))
  return results
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
  const isSize = opts.sort === "size"
  let merged: SearchResult[]
  if (filter === "mlx")  merged = await queryOne("mlx",  opts)
  else if (filter === "gguf") merged = await queryOne("gguf", opts)
  else {
    const [mlx, gguf] = await Promise.all([
      queryOne("mlx",  opts),
      queryOne("gguf", opts)
    ])
    // Interleave and dedupe. Preserve per-query order (which the API
    // already sorted for us).
    merged = []
    const max = Math.max(mlx.length, gguf.length)
    for (let i = 0; i < max; i++) {
      if (mlx[i]) merged.push(mlx[i])
      if (gguf[i]) merged.push(gguf[i])
    }
    merged = dedupe(merged)
  }
  if (isSize) merged = sortBySize(merged)
  return merged.slice(0, opts.limit ?? 20)
}

// Opaque cursor passed back to searchModelsPage to fetch the next
// page. For filter=any we paginate the mlx and gguf streams
// independently; either side may exhaust before the other.
export interface SearchCursor {
  one?:  string
  mlx?:  string
  gguf?: string
}

export interface SearchPage {
  results: SearchResult[]
  // When undefined, all underlying streams are exhausted.
  cursor?: SearchCursor
}

// Fetch one page of results. On the first call, omit `cursor`; the
// returned cursor (if any) is opaque and should be passed back on the
// next call. Caller is responsible for accumulating pages and for any
// post-sort that doesn't have a server-side equivalent (size).
export async function searchModelsPage(
  opts: SearchOpts = {},
  cursor?: SearchCursor
): Promise<SearchPage> {
  const filter = opts.filter ?? "any"
  if (filter === "mlx" || filter === "gguf") {
    const url = cursor?.one ?? buildSearchUrl(filter, opts)
    const { results, next } = await fetchPage(url)
    return { results, cursor: next ? { one: next } : undefined }
  }
  // filter === "any": paginate both streams, interleave fresh pages.
  const mlxUrl  = cursor?.mlx  ?? (cursor ? undefined : buildSearchUrl("mlx",  opts))
  const ggufUrl = cursor?.gguf ?? (cursor ? undefined : buildSearchUrl("gguf", opts))
  const [mlx, gguf] = await Promise.all([
    mlxUrl  ? fetchPage(mlxUrl)  : Promise.resolve({ results: [] as SearchResult[], next: undefined }),
    ggufUrl ? fetchPage(ggufUrl) : Promise.resolve({ results: [] as SearchResult[], next: undefined })
  ])
  const merged: SearchResult[] = []
  const max = Math.max(mlx.results.length, gguf.results.length)
  for (let i = 0; i < max; i++) {
    if (mlx.results[i])  merged.push(mlx.results[i])
    if (gguf.results[i]) merged.push(gguf.results[i])
  }
  const next: SearchCursor = {}
  if (mlx.next)  next.mlx  = mlx.next
  if (gguf.next) next.gguf = gguf.next
  return {
    results: dedupe(merged),
    cursor: (next.mlx || next.gguf) ? next : undefined
  }
}

// Re-export the size sorter so the TUI can re-apply it after each
// page merge without duplicating the comparator.
export { sortBySize }

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
