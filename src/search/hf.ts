import type { RuntimeType } from "../types/index.js"
import { fetchRepoInfo, fetchRepoTree, type HfSibling } from "../pull/api.js"

// Hub model search. Reference:
// https://huggingface.co/docs/hub/api#get-apimodels
// Relevant query parameters: search, author, filter (tag), sort,
// direction, limit. The `filter` parameter is tag-based: "mlx" and
// "gguf" are both widely-applied tags on the Hub.

export type SearchFilter = "mlx" | "gguf" | "any"
// "size" has no server-side equivalent on the Hub API; we ask the
// server for popularity-ranked candidates and re-sort client-side.
export type SearchSort = "downloads" | "likes" | "trending" | "modified" | "size" | "fit"

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
  pipelineTag?: string
  // On-disk size of the model weights in bytes. For GGUF we take
  // gguf.totalFileSize (when the Hub has indexed it); for MLX/
  // safetensors we sum parameters dict × bytes-per-dtype. Undefined
  // for repos the Hub hasn't parsed.
  sizeBytes?: number
  // Result came from an exact repo-id fallback rather than the normal
  // runtime-tag search, so callers can label it differently if needed.
  sourceFallback?: "exact-repo"
}

export interface SearchSelectionHint {
  runtime?: RuntimeType
  defaultFile?: string
  defaultFileSizeBytes?: number
  ggufFileCount?: number
  ggufSelectableCount?: number
  ggufCandidates?: Array<{ name: string; sizeBytes?: number }>
  ggufArchitecture?: string
  ggufContextLength?: number
  ggufTotalSizeBytes?: number
  baseModel?: string
  cardLicense?: string
}

export class HfSearchRateLimitError extends Error {
  readonly status = 429
  readonly url: string

  constructor(url: string) {
    super(`HF search 429 for ${url}`)
    this.name = "HfSearchRateLimitError"
    this.url = url
  }
}

const API = "https://huggingface.co/api/models"

function sortParam(sort: SearchSort): string {
  switch (sort) {
    case "downloads": return "downloads"
    case "likes":     return "likes"
    case "trending":  return "trendingScore"
    case "modified":  return "lastModified"
    // No server-side fit/size sort. Use downloads to bias toward results
    // that actually carry useful metadata, then re-sort client-side.
    case "size":      return "downloads"
    case "fit":       return "downloads"
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
    case "fit":       return r.downloads ?? -1
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

function isTextGenerationLike(pipelineTag: unknown): boolean {
  return (
    pipelineTag === "text-generation" ||
    pipelineTag === "conversational" ||
    pipelineTag === "image-text-to-text"
  )
}

const DISALLOWED_TASK_TAGS = new Set([
  "automatic-speech-recognition",
  "text-to-speech",
  "audio-to-audio",
  "feature-extraction",
  "image-classification",
  "text-classification",
  "token-classification",
  "question-answering",
  "sentence-similarity",
  "object-detection",
  "image-segmentation",
  "image-to-text",
  "visual-question-answering",
  "document-question-answering",
  "text-to-image",
  "image-to-image",
  "zero-shot-image-classification",
  "depth-estimation"
])

function isLikelyAthanorSearchCandidate(tags: string[], pipelineTag?: string): boolean {
  if (pipelineTag && !isTextGenerationLike(pipelineTag)) return false
  return !tags.some(tag => DISALLOWED_TASK_TAGS.has(tag))
}

function parseOne(raw: unknown, sourceFallback?: "exact-repo"): SearchResult | null {
  const b = raw as Record<string, unknown>
  if (b.private === true || b.gated === true) return null
  const tags = Array.isArray(b.tags) ? (b.tags as string[]) : []
  const pipelineTag = typeof b.pipeline_tag === "string"
    ? b.pipeline_tag
    : typeof b.pipelineTag === "string"
      ? b.pipelineTag
      : undefined
  if (!isLikelyAthanorSearchCandidate(tags, pipelineTag)) return null

  const rawId = String(b.id ?? b.modelId ?? "")
  if (!rawId) return null
  const runtime = runtimeFromTags(rawId, tags)
  return {
    id: rawId,
    downloads: typeof b.downloads === "number" ? b.downloads : undefined,
    likes: typeof b.likes === "number" ? b.likes : undefined,
    lastModified: typeof b.lastModified === "string" ? b.lastModified : undefined,
    trendingScore: typeof b.trendingScore === "number" ? b.trendingScore : undefined,
    tags,
    runtime,
    license: extractLicense(tags),
    pipelineTag,
    sizeBytes: sizeFromGguf(b.gguf) ?? sizeFromSafetensors(b.safetensors),
    sourceFallback
  }
}

function parse(body: unknown): SearchResult[] {
  if (!Array.isArray(body)) return []
  return body.flatMap((raw): SearchResult[] => {
    const parsed = parseOne(raw)
    if (!parsed?.runtime) return []
    return [parsed]
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
    "downloads", "likes", "lastModified", "tags", "trendingScore", "pipeline_tag"
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
  if (res.status === 429) throw new HfSearchRateLimitError(url)
  if (!res.ok) throw new Error(`HF search ${res.status} for ${url}`)
  const results = parse(await res.json())
  const next = parseLinkNext(res.headers.get("link"))
  return { next, results }
}

async function queryOne(filterTag: string | null, opts: SearchOpts): Promise<SearchResult[]> {
  const { results } = await fetchPage(buildSearchUrl(filterTag, opts))
  return results
}

function looksLikeRepoId(query: string | undefined): boolean {
  if (!query) return false
  const q = query.trim()
  if (!q || q.includes(" ")) return false
  const parts = q.split("/")
  return parts.length === 2 && parts.every(Boolean)
}

async function queryExactRepo(repo: string): Promise<SearchResult[]> {
  const url = `${API}/${repo}`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (res.status === 404) return []
  if (res.status === 429) throw new HfSearchRateLimitError(url)
  if (!res.ok) throw new Error(`HF search ${res.status} for ${url}`)
  const parsed = parseOne(await res.json(), "exact-repo")
  return parsed ? [parsed] : []
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
  if (filter === "mlx") merged = await queryOne("mlx", opts)
  else if (filter === "gguf") merged = await queryOne("gguf", opts)
  else {
    const extra = looksLikeRepoId(opts.query) ? queryExactRepo(opts.query!.trim()) : Promise.resolve([] as SearchResult[])
    const [mlx, gguf, exact] = await Promise.all([
      queryOne("mlx", opts),
      queryOne("gguf", opts),
      extra
    ])
    merged = sortByKey(sort, dedupe([...mlx, ...gguf, ...exact]))
  }
  if (filter !== "any" && (sort === "size" || sort === "fit")) merged = sortBySize(merged)
  return merged.slice(0, opts.limit ?? 20)
}

// Opaque cursor passed back to searchModelsPage to fetch the next
// page. For filter=any we paginate the mlx, gguf, and raw streams
// independently; any side may exhaust before the others.
export interface SearchCursor {
  one?:  string
  mlx?:  string
  gguf?: string
  raw?:  string
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
  // filter === "any": paginate mlx and gguf streams independently, then globally sort
  // the combined page by the active key. On the first page only, if the
  // query looks like an exact repo id (owner/name), also merge a direct
  // repo fetch so source-model repos can surface without the heavy raw search.
  const firstPage = cursor === undefined
  const mlxUrl  = cursor?.mlx  ?? (cursor ? undefined : buildSearchUrl("mlx", opts))
  const ggufUrl = cursor?.gguf ?? (cursor ? undefined : buildSearchUrl("gguf", opts))
  const exact = firstPage && looksLikeRepoId(opts.query)
    ? queryExactRepo(opts.query!.trim())
    : Promise.resolve([] as SearchResult[])
  const [mlx, gguf, extra] = await Promise.all([
    mlxUrl ? fetchPage(mlxUrl) : Promise.resolve({ results: [] as SearchResult[], next: undefined }),
    ggufUrl ? fetchPage(ggufUrl) : Promise.resolve({ results: [] as SearchResult[], next: undefined }),
    exact
  ])
  const merged = sortByKey(sort, dedupe([...mlx.results, ...gguf.results, ...extra]))
  const next: SearchCursor = {}
  if (mlx.next) next.mlx = mlx.next
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
    let treeSizes = new Map<string, number>()
    try {
      const tree = await fetchRepoTree(result.id)
      treeSizes = new Map<string, number>(
        tree
          .filter(entry => entry.type === "file" && entry.path.toLowerCase().endsWith(".gguf"))
          .map((entry): [string, number] => [entry.path, entry.lfs?.size ?? entry.size ?? 0])
          .filter((entry): entry is [string, number] => entry[1] > 0)
      )
    } catch {
      // Fall back to sibling metadata when tree lookup fails.
    }
    const candidatesWithSizes = candidates.map(c => ({
      ...c,
      size: treeSizes.get(c.rfilename) ?? c.size
    }))
    const chosen = pickDefaultGgufFile(candidatesWithSizes)
    return {
      runtime: "llama.cpp",
      defaultFile: chosen?.rfilename,
      defaultFileSizeBytes: chosen?.size,
      ggufFileCount: info.siblings.filter(s => s.rfilename.toLowerCase().endsWith(".gguf")).length,
      ggufSelectableCount: candidatesWithSizes.length,
      ggufCandidates: candidatesWithSizes.map(c => ({ name: c.rfilename, sizeBytes: c.size })),
      ggufArchitecture: info.gguf?.architecture,
      ggufContextLength: info.gguf?.contextLength,
      ggufTotalSizeBytes: info.gguf?.totalFileSize,
      baseModel: info.cardData?.baseModel,
      cardLicense: info.cardData?.license
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
