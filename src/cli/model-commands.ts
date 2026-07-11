import { listModels, getModel } from "../registry/index.js"
import { sortModelsByRecentUse } from "../registry/sort.js"
import { supervisor } from "../supervisor/index.js"
import { scanModelsAndReport, deleteModelFromDisk, restartModel, setFlavor, setPublished, startModel, stopModel, syncPiNow } from "../app/models.js"
import { SUGGESTIONS } from "../pull/suggestions.js"
import { tailLog } from "../supervisor/logs.js"
import { parseCompletionStats, sampleProcessStats, getLiveRouterStats } from "../supervisor/metrics.js"
import { formatEntryLine, formatUptime } from "./format.js"
import { style, sym, statusGlyph, padEndVisual } from "./style.js"
import { head, dim, info, ok, warn } from "./shared.js"
import * as readline from "readline/promises"
import { buildCommandFor, mergedConfigFor } from "../adapters/index.js"
import { detectMachineProfile } from "../machine/profile.js"
import { buildRecommendation } from "../registry/recommend.js"
import { getPersistedRouter, pidAlive } from "../supervisor/state.js"
import { validateLlamaSpeculativeConfig } from "../presets/edit.js"
import type { LlamaConfig } from "../types/index.js"

async function promptYesNo(prompt: string, defaultYes: boolean): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return defaultYes
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = defaultYes ? " [Y/n] " : " [y/N] "
    const answer = (await rl.question(`${prompt}${suffix}`)).trim().toLowerCase()
    if (!answer) return defaultYes
    return answer === "y" || answer === "yes"
  } finally {
    rl.close()
  }
}

export async function cmdScan(): Promise<void> {
  const rep = scanModelsAndReport()
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
  const models = sortModelsByRecentUse(listModels(), supervisor.list())
  if (models.length === 0) {
    warn(`registry empty — run ${style.bold("athanor scan")} to pick up existing downloads, or pull a starter model:`)
    console.log("")
    for (const s of SUGGESTIONS) {
      const tags = s.taskTags.join(", ")
      console.log(
        `  ${style.cyan(sym.bullet)} ${style.bold(s.label.padEnd(28))} ` +
        `${dim(s.sizeLabel.padEnd(10))}${dim(s.note)}`
      )
      console.log(`      ${dim(`tier ${s.memoryTier.toUpperCase()} · tasks ${tags}`)}`)
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
  const router = getPersistedRouter()
  const routerAlive = router ? pidAlive(router.pid) : false
  if (instances.length === 0) {
    if (router && routerAlive) {
      info(`no running instances · router ${style.green("up")} ${dim(`${router.host}:${router.port} pid=${router.pid}`)}`)
      return
    }
    info("no running instances")
    return
  }
  head(`${instances.length} running`)
  if (router && routerAlive) {
    console.log(`  ${padEndVisual(style.bold("router"), 32)}  ${padEndVisual(style.cyan("ingress"), 10)}  ${padEndVisual(dim(`${router.host}:${router.port}`), 7)}  ${dim(`pid=${router.pid}`)}`)
  }
  const proc = sampleProcessStats(instances.map(i => i.pid))
  for (const i of instances) {
    const p = proc.get(i.pid)
    const comp = getLiveRouterStats(i.id) ?? parseCompletionStats(tailLog(i.logFile, 16384))
    const cpu = p ? `${p.cpuPct.toFixed(0)}%` : "?"
    const rss = p
      ? (p.rssBytes / 1024 / 1024 / 1024 >= 1
          ? `${(p.rssBytes / 1024 / 1024 / 1024).toFixed(1)}G`
          : `${(p.rssBytes / 1024 / 1024).toFixed(0)}M`)
      : "?"
    const tps = comp ? `${comp.tokPerSec.toFixed(1)} tok/s` : dim("— tok/s")
    const startup = i.healthyAt && i.spawnStartedAt
      ? dim(`ready ${((i.healthyAt - i.spawnStartedAt) / 1000).toFixed(1)}s`)
      : dim("ready ?")
    const line = [
      padEndVisual(`${statusGlyph(i.status)} ${i.status}`, 11),
      padEndVisual(style.bold(i.slug), 32),
      padEndVisual(style.cyan(i.runtime), 10),
      padEndVisual(dim(`:${i.port}`), 7),
      padEndVisual(dim(`up ${formatUptime(i.startedAt)}`), 10),
      padEndVisual(startup, 12),
      padEndVisual(cpu, 6),
      padEndVisual(rss, 6),
      tps
    ].join("  ")
    console.log("  " + line)
  }
}

export async function cmdStart(idOrSlug: string): Promise<void> {
  let res = await startModel(idOrSlug)
  if (res.warned && res.preflight) {
    const level = res.preflight.shouldStrongWarn ? style.red("strong warning") : style.yellow("warning")
    console.log(`${level} ${dim(`current snapshot: ~${res.preflight.currentUsedGiB.toFixed(1)} GiB used / ${res.preflight.machineTotalGiB.toFixed(0)} GiB`)}`)
    console.log(`  ${dim(`model estimate: ~${res.preflight.estimatedFootprintGiB.toFixed(1)} GiB; projected total ~${res.preflight.projectedUsedGiB.toFixed(1)} GiB`)}`)
    console.log(`  ${dim("this is a current memory snapshot, not a guarantee")}`)
    const answer = await promptYesNo("launch anyway?", false)
    if (!answer) {
      info("start cancelled")
      return
    }
    res = await startModel(idOrSlug, { confirm: true })
  }
  if (!res.instance) throw new Error(`failed to start ${idOrSlug}`)
  ok(`started ${style.bold(res.entry.slug)} ${dim(`pid=${res.instance.pid} port=${res.instance.port}`)}`)
}

export async function cmdStop(idOrSlug?: string): Promise<void> {
  const res = await stopModel(idOrSlug)
  if (!res.stopped) {
    if (res.stoppedAll) {
      ok("no running instances to stop")
    } else {
      ok(`${style.bold(res.entry!.slug)} was not running`)
    }
    return
  }
  if (res.stoppedAll) {
    ok("stopped all")
    return
  }
  ok(`stopped ${style.bold(res.entry!.slug)}`)
}

export async function cmdRestart(idOrSlug: string): Promise<void> {
  let res = await restartModel(idOrSlug)
  if (res.warned && res.preflight) {
    const level = res.preflight.shouldStrongWarn ? style.red("strong warning") : style.yellow("warning")
    console.log(`${level} ${dim(`current snapshot: ~${res.preflight.currentUsedGiB.toFixed(1)} GiB used / ${res.preflight.machineTotalGiB.toFixed(0)} GiB`)}`)
    console.log(`  ${dim(`model estimate: ~${res.preflight.estimatedFootprintGiB.toFixed(1)} GiB; projected total ~${res.preflight.projectedUsedGiB.toFixed(1)} GiB`)}`)
    console.log(`  ${dim("this is a current memory snapshot, not a guarantee")}`)
    const answer = await promptYesNo("restart anyway?", false)
    if (!answer) {
      info("restart cancelled")
      return
    }
    res = await restartModel(idOrSlug, { confirm: true })
  }
  if (!res.instance) throw new Error(`failed to restart ${idOrSlug}`)
  ok(`restarted ${style.bold(res.entry.slug)} ${dim(`pid=${res.instance.pid}`)}`)
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

export function cmdExpose(idOrSlug: string, expose: boolean): void {
  const entry = setPublished(idOrSlug, expose)
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
  const updated = setFlavor(entry.id, value)
  const label = value === "vlm" ? "mlx-vlm" : "mlx-lm"
  ok(`${style.bold(updated.slug)} flavor → ${style.cyan(label)}`)
  const running = supervisor.list().some(i => i.id === updated.id)
  if (running) info(`restart to apply: ${style.bold(`athanor restart ${updated.slug}`)}`)
}

export function cmdRm(idOrSlug: string): void {
  const inst = supervisor.list().find(i => i.id === idOrSlug || i.slug === idOrSlug)
  if (inst) throw new Error(`cannot remove ${idOrSlug}: currently running (stop it first)`)
  const entry = deleteModelFromDisk(idOrSlug)
  ok(`deleted ${style.bold(entry.slug)} from disk`)
}

export async function cmdSync(): Promise<void> {
  const instances = supervisor.list()
  const active = instances[0]
  await syncPiNow(active)
  const n = listModels().filter(m => m.publish).length
  ok(`pi sync: ${style.bold(String(n))} model${n === 1 ? "" : "s"} exposed`)
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

  const machine = detectMachineProfile()
  const rec = buildRecommendation(entry, machine)
  head("recommendation")
  const fitLabel = rec.confidence === "low"
    ? `${rec.fitBand} ${style.yellow("(estimate)")}`
    : rec.fitBand
  console.log(`  ${dim("fit")}      ${fitLabel} ${dim(`(~${rec.estimatedFootprintGiB.toFixed(1)} GiB estimated / ${machine.totalMemoryGiB.toFixed(0)} GiB)` )}`)
  console.log(`  ${dim("context")}  ${rec.recommendedContext}  ${dim(rec.recommendedContextNote)}`)
  console.log(`  ${dim("why")}      ${rec.explanation}`)
  if (rec.presetHint) {
    console.log(`  ${dim("preset")}   ${rec.presetHint}  ${dim(rec.presetHintReason ?? "")}`)
  }
  console.log(`  ${dim("next")}     ${dim(`start here, then tune with athanor preset apply ${entry.slug} ${rec.presetHint ?? "balanced"} or athanor preset set ${entry.slug} ...`)}`)
  console.log(`  ${dim("confidence")} ${rec.confidence}${entry.metadataSource ? dim(` (${entry.metadataSource})`) : ""}`)
  console.log()

  head("effective config")
  if (entry.preset) {
    console.log(dim("  preset active"))
  } else {
    console.log(dim("  no preset — using global defaults"))
  }
  for (const [k, v] of Object.entries(merged)) {
    const override = entry.preset
      && entry.preset.runtime === entry.runtime
      && (entry.preset.runtime === "mlx"
          ? (entry.preset.mlx as Record<string, unknown>)[k] !== undefined
          : (entry.preset.llama as Record<string, unknown>)[k] !== undefined)
    const marker = override ? style.yellow(" *") : "  "
    console.log(`  ${k.padEnd(20)} ${String(v)}${marker}`)
  }
  console.log()

  if (entry.runtime === "llama.cpp") {
    const warnings = validateLlamaSpeculativeConfig(merged as unknown as LlamaConfig)
    if (warnings.length > 0) {
      console.log(`  ${style.yellow("speculative validation warnings:")}`)
      for (const w of warnings) {
        console.log(`    ${style.yellow("⚠")} ${dim(w)}`)
      }
      console.log()
    }
  }

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
