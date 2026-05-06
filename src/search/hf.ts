import type { RuntimeType } from "../types/index.js"
import { fetchRepoInfo, type HfSibling } from "../pull/api.js"

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
  // Hub-computed trending score; returned when the caller requests
  // it via expand[] or sort=trendingScore. Used by client-side sort
  // when merging mlx + gguf streams under filter="any".
  trendingScore?: number
  tags: string[]
  runtime?: RuntimeType
  license?: string
  // On-disk size of the model weights in bytes. For GGUF we take
  // gguf.totalFileSize (when the Hub has indexed it); for MLX/
  // safetensors we sum parameters dict × bytes-per-dtype. Undefined
  // for repos the Hub hasn't parsed.
  sizeBytes?: number
}

export interface SearchSelectionHint {
  runtime?: RuntimeType
  defaultFile?: string
  defaultFileSizeBytes?: number
  ggufFileCount?: number
  ggufSelectableCount?: number
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

// Numeric value for the active sort key. Missing fields return -1 so
// entries the Hub hasn't indexed sink to the bottom instead of being
// hoisted to the top (which would happen with a `?? 0` default when
// counts are non-negative).
function sortValue(sort: SearchSort, r: SearchResult): number {
  switch (sort) {
    case "downloads": return r.downloads ?? -1
    case "likes":     return r.likes ?? -1
    case "trending":  return r.trendingScore ?? -1
    case "modified":  return r.lastModified ? Date.parse(r.lastModified) : -1
    case "size":      return r.sizeBytes ?? -1
  }
}

// Client-side sort used to globally merge the mlx + gguf streams when
// filter="any" (each stream is server-sorted independently, so a
// simple interleave leaves the union out of order on the active key).
// Also used by the TUI to re-sort across paginated page boundaries
// for the same reason. Descending in all cases.
export function sortByKey(sort: SearchSort, rs: SearchResult[]): SearchResult[] {
  return [...rs].sort((a, b) => sortValue(sort, b) - sortValue(sort, a))
}

// Retained as a thin alias so existing callers that specifically want
// a size sort (e.g. single-filter TUI loads where the server sort is
// popularity) read clearly at the call site.
function sortBySize(rs: SearchResult[]): SearchResult[] {
  return sortByKey("size", rs)
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
      trendingScore: typeof b.trendingScore === "number" ? b.trendingScore : undefined,
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
    "downloads", "likes", "lastModified", "tags", "trendingScore"
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
// returns results ordered with the primary sort key descending. For
// filter="any" the mlx and gguf streams each arrive pre-sorted by the
// server on their own axis; the client-side sortByKey is what makes
// the merged result set a true global ordering rather than a
// round-robin interleave of two independent sorts.
export async function searchModels(opts: SearchOpts = {}): Promise<SearchResult[]> {
  const filter = opts.filter ?? "any"
  const sort   = opts.sort   ?? "downloads"
  let merged: SearchResult[]
  if (filter === "mlx")  merged = await queryOne("mlx",  opts)
  else if (filter === "gguf") merged = await queryOne("gguf", opts)
  else {
    const [mlx, gguf] = await Promise.all([
      queryOne("mlx",  opts),
      queryOne("gguf", opts)
    ])
    merged = dedupe([...mlx, ...gguf])
    merged = sortByKey(sort, merged)
  }
  if (filter !== "any" && sort === "size") merged = sortBySize(merged)
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
// next call. For filter="any" the merged page is globally sorted by
// the active key across both streams; the caller is still responsible
// for re-sorting the union across page boundaries (see SearchBrowser).
export async function searchModelsPage(
  opts: SearchOpts = {},
  cursor?: SearchCursor
): Promise<SearchPage> {
  const filter = opts.filter ?? "any"
  const sort   = opts.sort   ?? "downloads"
  if (filter === "mlx" || filter === "gguf") {
    const url = cursor?.one ?? buildSearchUrl(filter, opts)
    const { results, next } = await fetchPage(url)
    return { results, cursor: next ? { one: next } : undefined }
  }
  // filter === "any": paginate both streams, then globally sort the
  // combined page by the active key. A round-robin interleave would
  // show "popular-mlx, popular-gguf, 2nd-mlx, 2nd-gguf, …" which is
  // what makes the original result order look like two lists glued
  // together rather than a single ranked list.
  const mlxUrl  = cursor?.mlx  ?? (cursor ? undefined : buildSearchUrl("mlx",  opts))
  const ggufUrl = cursor?.gguf ?? (cursor ? undefined : buildSearchUrl("gguf", opts))
  const [mlx, gguf] = await Promise.all([
    mlxUrl  ? fetchPage(mlxUrl)  : Promise.resolve({ results: [] as SearchResult[], next: undefined }),
    ggufUrl ? fetchPage(ggufUrl) : Promise.resolve({ results: [] as SearchResult[], next: undefined })
  ])
  const merged = sortByKey(sort, dedupe([...mlx.results, ...gguf.results]))
  const next: SearchCursor = {}
  if (mlx.next)  next.mlx  = mlx.next
  if (gguf.next) next.gguf = gguf.next
  return {
    results: merged,
    cursor: (next.mlx || next.gguf) ? next : undefined
  }
}

function isMmproj(name: string): boolean {
  return /(^|\/)mmproj[-_]/i.test(name)
}

function isShard(name: string): boolean {
  return /-\d{5}-of-\d{5}\.gguf$/i.test(name)
}

function quantRank(name: string): number {
  const n = name.toUpperCase()
  if (n.includes("Q4_K_M")) return 1000
  if (n.includes("Q5_K_M")) return 900
  if (n.includes("Q6_K")) return 800
  if (n.includes("Q4_K_S")) return 700
  if (n.includes("Q8_0")) return 600
  if (/Q\d+_K_[A-Z]+/.test(n)) return 500
  if (/IQ4/.test(n)) return 400
  if (/IQ3/.test(n)) return 300
  if (/IQ2/.test(n)) return 200
  return 100
}

function ggufCandidates(siblings: HfSibling[]): HfSibling[] {
  return siblings.filter(s => {
    const name = s.rfilename
    return name.toLowerCase().endsWith(".gguf") && !isMmproj(name) && !isShard(name)
  })
}

function pickDefaultGgufFile(siblings: HfSibling[]): HfSibling | undefined {
  const candidates = ggufCandidates(siblings)
  if (candidates.length === 0) return undefined
  return [...candidates].sort((a, b) => {
    const rank = quantRank(b.rfilename) - quantRank(a.rfilename)
    if (rank !== 0) return rank
    const sizeA = a.size ?? Number.POSITIVE_INFINITY
    const sizeB = b.size ?? Number.POSITIVE_INFINITY
    if (sizeA !== sizeB) return sizeA - sizeB
    return a.rfilename.localeCompare(b.rfilename)
  })[0]
}

const selectionHintCache = new Map<string, Promise<SearchSelectionHint> | SearchSelectionHint>()

export async function enrichSelectionHint(result: SearchResult): Promise<SearchSelectionHint> {
  const cached = selectionHintCache.get(result.id)
  if (cached) return await cached
  const pending = (async (): Promise<SearchSelectionHint> => {
    if (result.runtime !== "llama.cpp") return { runtime: result.runtime }
    const info = await fetchRepoInfo(result.id)
    const candidates = ggufCandidates(info.siblings)
    const chosen = pickDefaultGgufFile(info.siblings)
    return {
      runtime: "llama.cpp",
      defaultFile: chosen?.rfilename,
      defaultFileSizeBytes: chosen?.size,
      ggufFileCount: info.siblings.filter(s => s.rfilename.toLowerCase().endsWith(".gguf")).length,
      ggufSelectableCount: candidates.length
    }
  })()
  selectionHintCache.set(result.id, pending)
  try {
    const resolved = await pending
    selectionHintCache.set(result.id, resolved)
    return resolved
  } catch (error) {
    selectionHintCache.delete(result.id)
    throw error
  }
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
