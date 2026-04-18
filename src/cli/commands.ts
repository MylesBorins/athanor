import * as fs from "fs"
import { loadConfig, PATHS } from "../config/index.js"
import {
  getModel,
  listModels,
  removeModel,
  updateModel
} from "../registry/index.js"
import { ingestDiscovered } from "../discovery/ingest.js"
import { supervisor } from "../supervisor/index.js"
import { syncPi } from "../sync/pi.js"
import { pull } from "../pull/hf.js"
import { PullAbortedError } from "../pull/download.js"
import { SUGGESTIONS } from "../pull/suggestions.js"
import { tailLog } from "../supervisor/logs.js"
import { parseCompletionStats, sampleProcessStats } from "../supervisor/metrics.js"
import { formatEntryLine, formatUptime } from "./format.js"
import { which } from "./doctor.js"
import { style, sym, statusGlyph, padEndVisual } from "./style.js"
import { searchModels, groupByRuntime, type SearchFilter, type SearchSort } from "../search/hf.js"
import { formatResultRow } from "../search/format.js"
import { buildCommandFor, mergedConfigFor } from "../adapters/index.js"
import { findRecipe, listRecipes, recipeToPreset } from "../presets/recipes.js"
import { listKeys, parseKvTokens, setPresetFields, unsetPresetFields } from "../presets/edit.js"
import { startRouter, stopRouter } from "../router/server.js"

function ok(msg: string): void   { console.log(`${style.green(sym.check)} ${msg}`) }
function info(msg: string): void { console.log(`${style.cyan(sym.arrow)} ${msg}`) }
function warn(msg: string): void { console.log(`${style.yellow(sym.warn)} ${msg}`) }
function head(msg: string): void { console.log(style.bold(msg)) }
function dim(msg: string): string { return style.gray(msg) }

export async function cmdScan(): Promise<void> {
  const rep = ingestDiscovered()
  const parts = [
    `${style.green("+" + rep.added.length)} new`,
    `${style.yellow(String(rep.updatedPath.length))} path-updated`,
    `${dim(String(rep.unchanged) + " unchanged")}`
  ]
  ok(`scan complete  ${parts.join("  ")}`)
  for (const e of rep.added) {
    console.log(
      `  ${style.green(sym.bullet)} ${style.bold(e.slug.padEnd(30))} ` +
      `${style.cyan(e.runtime.padEnd(10))} ${dim(":" + e.port)}`
    )
  }
}

export function cmdList(): void {
  const models = listModels()
  if (models.length === 0) {
    warn(`registry empty — run ${style.bold("athanor scan")} to pick up existing downloads, or pull a starter model:`)
    console.log("")
    for (const s of SUGGESTIONS) {
      console.log(
        `  ${style.cyan(sym.bullet)} ${style.bold(s.label.padEnd(28))} ` +
        `${dim(s.sizeLabel.padEnd(10))}${dim(s.note)}`
      )
      console.log(`      ${dim(`athanor pull ${s.repo}`)}`)
    }
    return
  }
  const active = new Map(supervisor.list().map(i => [i.id, i] as const))
  head(`${models.length} model${models.length === 1 ? "" : "s"}`)
  for (const m of models) console.log("  " + formatEntryLine(m, active.get(m.id)))
}

export function cmdStatus(): void {
  const instances = supervisor.list()
  if (instances.length === 0) { info("no running instances"); return }
  head(`${instances.length} running`)
  const proc = sampleProcessStats(instances.map(i => i.pid))
  for (const i of instances) {
    const p = proc.get(i.pid)
    const comp = parseCompletionStats(tailLog(i.logFile, 16384))
    const cpu = p ? `${p.cpuPct.toFixed(0)}%` : "?"
    const rss = p
      ? (p.rssBytes / 1024 / 1024 / 1024 >= 1
          ? `${(p.rssBytes / 1024 / 1024 / 1024).toFixed(1)}G`
          : `${(p.rssBytes / 1024 / 1024).toFixed(0)}M`)
      : "?"
    const tps = comp ? `${comp.tokPerSec.toFixed(1)} tok/s` : dim("— tok/s")
    const line = [
      padEndVisual(`${statusGlyph(i.status)} ${i.status}`, 11),
      padEndVisual(style.bold(i.slug), 32),
      padEndVisual(style.cyan(i.runtime), 10),
      padEndVisual(dim(`:${i.port}`), 7),
      padEndVisual(dim(`up ${formatUptime(i.startedAt)}`), 10),
      padEndVisual(cpu, 6),
      padEndVisual(rss, 6),
      tps
    ].join("  ")
    console.log("  " + line)
  }
}

export async function cmdStart(idOrSlug: string): Promise<void> {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const inst = await supervisor.start(entry)
  syncPi({ activeDefault: inst, instances: supervisor.list() })
  ok(`started ${style.bold(entry.slug)} ${dim(`pid=${inst.pid} port=${inst.port}`)}`)
}

export async function cmdStop(idOrSlug?: string): Promise<void> {
  if (!idOrSlug || idOrSlug === "--all") {
    await supervisor.stopAll()
    syncPi({ instances: [] })
    ok("stopped all")
    return
  }
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  await supervisor.stop(entry.id)
  syncPi({ instances: supervisor.list() })
  ok(`stopped ${style.bold(entry.slug)}`)
}

export async function cmdRestart(idOrSlug: string): Promise<void> {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const inst = await supervisor.restart(entry)
  syncPi({ activeDefault: inst, instances: supervisor.list() })
  ok(`restarted ${style.bold(entry.slug)} ${dim(`pid=${inst.pid}`)}`)
}

export function cmdLogs(idOrSlug: string, n = 200): void {
  const inst = supervisor.list().find(i => i.id === idOrSlug || i.slug === idOrSlug)
  if (!inst) {
    const entry = getModel(idOrSlug)
    if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
    warn("no running instance; no log available")
    return
  }
  const text = tailLog(inst.logFile, Math.max(1024, n * 120))
  const lines = text.split("\n")
  console.log(lines.slice(-n).join("\n"))
}

export async function cmdPull(repo: string, file?: string, revision?: string): Promise<void> {
  // inherit=true lets `hf`'s tqdm progress bar paint straight to the
  // terminal instead of being line-split and reprinted with \n, which
  // collapsed progress frames into thousands of near-identical lines.
  //
  // SIGINT/SIGTERM trigger an explicit abort of the hf child. Ctrl-C
  // normally reaches the whole foreground group, but hf's Python
  // workers don't always clean up before Node exits, which could
  // orphan them. Aborting explicitly SIGTERMs the child and escalates
  // to SIGKILL after a grace window.
  const ctl = new AbortController()
  const onSignal = (sig: NodeJS.Signals): void => {
    warn(`received ${sig}, cancelling pull…`)
    ctl.abort()
  }
  const onInt = (): void => onSignal("SIGINT")
  const onTerm = (): void => onSignal("SIGTERM")
  process.on("SIGINT", onInt)
  process.on("SIGTERM", onTerm)
  try {
    const res = await pull({ repo, file, revision, inherit: true, signal: ctl.signal })
    ok(`pulled ${style.bold(res.entry.slug)} ${dim(`${sym.arrow} ${res.entry.id} (port ${res.entry.port})`)}`)
  } catch (err: unknown) {
    if (err instanceof PullAbortedError) {
      warn("pull cancelled")
      process.exit(130)
    }
    throw err
  } finally {
    process.off("SIGINT", onInt)
    process.off("SIGTERM", onTerm)
  }
}

export function cmdExpose(idOrSlug: string, expose: boolean): void {
  const entry = updateModel(idOrSlug, { publish: expose })
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  syncPi({ instances: supervisor.list() })
  const tag = expose ? style.magenta("[pi]") : style.gray("[-]")
  ok(`${style.bold(entry.slug)} ${tag} ${dim(expose ? "exposed" : "hidden")}`)
}

export function cmdFlavor(idOrSlug: string, value: string): void {
  if (value !== "lm" && value !== "vlm") {
    throw new Error(`flavor must be lm or vlm, got ${value}`)
  }
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  if (entry.runtime !== "mlx") {
    throw new Error(`flavor only applies to mlx entries (${entry.slug} is ${entry.runtime})`)
  }
  if (entry.mlxFlavor === value) {
    info(`${style.bold(entry.slug)} already ${style.cyan(value)}`)
    return
  }
  if (value === "vlm" && !(entry.mlxCapabilities ?? []).includes("vlm")) {
    warn(`${style.bold(entry.slug)} has no detected vision tower — mlx_vlm.server will likely fail at load`)
  }
  const updated = updateModel(entry.id, { mlxFlavor: value })!
  syncPi({ instances: supervisor.list() })
  const label = value === "vlm" ? "mlx-vlm" : "mlx-lm"
  ok(`${style.bold(updated.slug)} flavor → ${style.cyan(label)}`)
  const running = supervisor.list().some(i => i.id === updated.id)
  if (running) info(`restart to apply: ${style.bold(`athanor restart ${updated.slug}`)}`)
}

export function cmdRm(idOrSlug: string): void {
  const inst = supervisor.list().find(i => i.id === idOrSlug || i.slug === idOrSlug)
  if (inst) throw new Error(`cannot remove ${idOrSlug}: currently running (stop it first)`)
  if (!removeModel(idOrSlug)) throw new Error(`unknown model: ${idOrSlug}`)
  syncPi({ instances: supervisor.list() })
  ok(`removed ${style.bold(idOrSlug)}`)
}

export function cmdSync(): void {
  const instances = supervisor.list()
  const active = instances[0]
  syncPi({ activeDefault: active, instances })
  const n = listModels().filter(m => m.publish).length
  ok(`pi sync: ${style.bold(String(n))} model${n === 1 ? "" : "s"} exposed`)
}

export function cmdConfig(): void {
  const cfg = loadConfig()
  head("config")
  console.log(`  ${dim("path")}  ${PATHS.config}`)
  console.log()
  console.log(JSON.stringify(cfg, null, 2))
}

export interface SearchCmdOpts {
  query?: string
  filter?: SearchFilter
  author?: string
  sort?: SearchSort
  limit?: number
}

export async function cmdSearch(opts: SearchCmdOpts): Promise<void> {
  const results = await searchModels(opts)
  if (results.length === 0) {
    warn("no results")
    return
  }
  const { mlx, gguf, other } = groupByRuntime(results)
  if (mlx.length) {
    head(`MLX  ${dim(`(${mlx.length})`)}`)
    for (const r of mlx) console.log("  " + formatResultRow(r))
    console.log()
  }
  if (gguf.length) {
    head(`GGUF  ${dim(`(${gguf.length}) — llama.cpp`)}`)
    for (const r of gguf) console.log("  " + formatResultRow(r))
    console.log()
  }
  if (other.length) {
    head(`other  ${dim(`(${other.length})`)}`)
    for (const r of other) console.log("  " + formatResultRow(r))
    console.log()
  }
  console.log(dim("next:"))
  console.log(`  ${style.cyan(sym.arrow)} ${style.bold("athanor pull <repo>")}                 ${dim("# MLX: downloads the whole repo")}`)
  console.log(`  ${style.cyan(sym.arrow)} ${style.bold("athanor pull <repo> --file F.gguf")}   ${dim("# GGUF: pick one file")}`)
}

export function cmdShow(idOrSlug: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const inst = supervisor.list().find(i => i.id === entry.id)
  const merged = mergedConfigFor(entry) as unknown as Record<string, unknown>
  const { cmd, args } = buildCommandFor(entry)

  const runtimeLabel = entry.runtime === "mlx" && entry.mlxFlavor === "vlm"
    ? "mlx-vlm"
    : entry.runtime
  head(entry.slug)
  console.log(`  ${dim("id")}       ${entry.id}`)
  console.log(`  ${dim("runtime")}  ${style.cyan(runtimeLabel)}`)
  console.log(`  ${dim("path")}     ${entry.path}`)
  console.log(`  ${dim("port")}     ${entry.port}`)
  console.log(`  ${dim("exposed")}  ${entry.publish ? style.magenta("yes (pi)") : "no"}`)
  console.log(`  ${dim("source")}   ${entry.source.type === "hf" ? `hf:${entry.source.repo}` : "local"}`)
  if (entry.runtime === "mlx") {
    const caps = entry.mlxCapabilities ?? []
    const capsLabel = caps.length > 0 ? caps.join(", ") : dim("(none detected)")
    console.log(`  ${dim("caps")}     ${capsLabel}`)
    if (caps.includes("vlm") && entry.mlxFlavor !== "vlm") {
      console.log(`  ${dim("hint")}     ${style.yellow("vision-capable")} — enable with ${style.bold(`athanor flavor ${entry.slug} vlm`)}`)
    }
  }
  const status = inst ? `${statusGlyph(inst.status)} ${inst.status}` : `${style.gray(sym.idle)} idle`
  console.log(`  ${dim("status")}   ${status}`)
  console.log()

  head("effective config")
  if (entry.preset) {
    console.log(dim(`  preset active (overrides global defaults)`))
  } else {
    console.log(dim("  no preset — using global defaults"))
  }
  for (const [k, v] of Object.entries(merged)) {
    const override = entry.preset
      && entry.preset.runtime === entry.runtime
      && (entry.preset.runtime === "mlx"
          ? (entry.preset.mlx as any)[k] !== undefined
          : (entry.preset.llama as any)[k] !== undefined)
    const marker = override ? style.yellow(" *") : "  "
    console.log(`  ${k.padEnd(20)} ${String(v)}${marker}`)
  }
  console.log()

  head("command")
  console.log(`  ${style.bold(cmd)} ${args.join(" ")}`)
  console.log()

  head("tune")
  console.log(`  ${style.cyan(sym.arrow)} ${style.bold(`athanor preset set ${entry.slug} key=value ...`)}`)
  console.log(`  ${style.cyan(sym.arrow)} ${style.bold(`athanor preset apply ${entry.slug} <recipe>`)}`)
  console.log(`  ${style.cyan(sym.arrow)} ${style.bold(`athanor recipes`)}  ${dim("# list available recipes")}`)
  if (entry.runtime === "mlx") {
    console.log(`  ${style.cyan(sym.arrow)} ${style.bold(`athanor flavor ${entry.slug} lm|vlm`)}  ${dim("# force mlx_lm vs mlx_vlm server")}`)
  }
}

export function cmdPresetShow(idOrSlug: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  head(`preset: ${entry.slug}`)
  if (!entry.preset) { console.log("  " + dim("(none)")); return }
  console.log(JSON.stringify(entry.preset, null, 2)
    .split("\n").map(l => "  " + l).join("\n"))
}

export function cmdPresetSet(idOrSlug: string, tokens: string[]): void {
  if (tokens.length === 0) throw new Error("expected one or more key=value pairs")
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const preset = setPresetFields(entry, parseKvTokens(tokens))
  updateModel(entry.id, { preset })
  syncPi({ instances: supervisor.list() })
  ok(`${style.bold(entry.slug)} preset updated ${dim(`(${tokens.length} field${tokens.length === 1 ? "" : "s"})`)}`)
  info(`restart to apply: ${style.bold(`athanor restart ${entry.slug}`)}`)
}

export function cmdPresetUnset(idOrSlug: string, keys: string[]): void {
  if (keys.length === 0) throw new Error("expected one or more keys")
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const preset = unsetPresetFields(entry, keys)
  updateModel(entry.id, { preset })
  syncPi({ instances: supervisor.list() })
  ok(`${style.bold(entry.slug)} preset ${preset ? "updated" : "cleared"}`)
}

export function cmdPresetClear(idOrSlug: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  updateModel(entry.id, { preset: undefined })
  syncPi({ instances: supervisor.list() })
  ok(`${style.bold(entry.slug)} preset cleared`)
}

export function cmdPresetApply(idOrSlug: string, recipeName: string): void {
  const entry = getModel(idOrSlug)
  if (!entry) throw new Error(`unknown model: ${idOrSlug}`)
  const recipe = findRecipe(recipeName)
  if (!recipe) throw new Error(`unknown recipe: ${recipeName}. Try 'athanor recipes'`)
  const preset = recipeToPreset(recipe, entry.runtime)
  updateModel(entry.id, { preset })
  syncPi({ instances: supervisor.list() })
  const tag = preset ? style.bold(recipeName) : `${style.bold(recipeName)} ${dim("(no-op for " + entry.runtime + ")")}`
  ok(`${style.bold(entry.slug)} ← recipe ${tag}`)
  if (preset) info(`restart to apply: ${style.bold(`athanor restart ${entry.slug}`)}`)
}

export function cmdRecipes(): void {
  const recipes = listRecipes()
  head(`recipes (${recipes.length})`)
  const widest = Math.max(...recipes.map(r => r.name.length))
  for (const r of recipes) {
    const tag = r.source === "user" ? style.magenta(" [user]") : style.gray(" [builtin]")
    console.log(`  ${style.bold(r.name.padEnd(widest))}${tag}  ${dim(r.description)}`)
  }
  console.log()
  head("tunable keys")
  for (const rt of ["mlx", "llama.cpp"] as const) {
    console.log(`  ${style.cyan(rt)}`)
    for (const k of listKeys(rt)) {
      console.log(`    ${style.bold(k.aliases[0]!.padEnd(22))} ${dim(k.help)}`)
    }
  }
}

export async function cmdRouter(opts: { host?: string; port?: number }): Promise<void> {
  const cfg = loadConfig()
  const host = opts.host ?? cfg.router.host
  const port = opts.port ?? cfg.router.port
  const server = startRouter({ host, port, force: true, silent: true })
  if (!server) throw new Error("router already running in this process")
  ok(`athanor router listening on ${style.bold(`http://${host}:${port}`)}`)
  info(`exposed models: ${listModels().filter(m => m.publish).length} — ${dim("Ctrl-C to stop")}`)
  await new Promise<void>(resolve => {
    const shutdown = (): void => { void stopRouter().then(resolve) }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  })
}

export async function cmdDoctor(): Promise<void> {
  const bins = ["mlx_lm.server", "mlx_vlm.server", "llama-server", "hf"]
  head("binaries")
  const widest = Math.max(...bins.map(b => b.length))
  for (const b of bins) {
    const p = await which(b)
    const mark = p ? style.green(sym.check) : style.red(sym.cross)
    const val = p ? dim(p) : style.red("NOT FOUND")
    console.log(`  ${mark} ${b.padEnd(widest)}  ${val}`)
  }
  console.log()
  head("paths")
  const label = (s: string): string => dim(s.padEnd(8))
  console.log(`  ${label("config")}  ${fs.existsSync(PATHS.config) ? PATHS.config : dim("(default, not written)")}`)
  console.log(`  ${label("registry")}  ${fs.existsSync(PATHS.registry) ? PATHS.registry : dim("(empty)")}`)
  console.log(`  ${label("logs")}  ${PATHS.logsDir}`)
}
