import * as fs from "fs"
import React from "react"
import { render } from "ink"
import { loadConfig, PATHS } from "../config/index.js"
import { listModels } from "../registry/index.js"
import { binaryUpdateStatus, binaryVersion, which } from "./doctor.js"
import { style, sym } from "./style.js"
import { SearchBrowser } from "../ui/SearchBrowser.js"
import { HfSearchRateLimitError, searchModels, groupByRuntime, type SearchFilter, type SearchSort } from "../search/hf.js"
import { formatResultRow } from "../search/format.js"
import { buildSearchRecommendation, sortByFit } from "../search/recommend.js"
import { detectMachineProfile } from "../machine/profile.js"
import { startRouter, stopRouter } from "../router/server.js"
import { dim, head, info, ok, warn } from "./shared.js"

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

const ENTER_ALT_SCREEN = "\x1b[?1049h"
const LEAVE_ALT_SCREEN = "\x1b[?1049l"
const HIDE_CURSOR = "\x1b[?25l"
const SHOW_CURSOR = "\x1b[?25h"

async function runSearchTui(opts: SearchCmdOpts): Promise<void> {
  process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR)
  const restore = (): void => { process.stdout.write(SHOW_CURSOR + LEAVE_ALT_SCREEN) }
  let finalMessage: string | undefined
  const instance = render(
    React.createElement(SearchBrowser, {
      initialQuery: opts.query,
      initialFilter: opts.filter,
      initialSort: opts.sort,
      onExit: (msg) => { finalMessage = msg }
    }),
    { exitOnCtrlC: true }
  )
  try {
    await instance.waitUntilExit()
  } finally {
    restore()
  }
  if (finalMessage) ok(finalMessage)
}

export async function cmdSearch(opts: SearchCmdOpts): Promise<void> {
  const isInteractive = process.stdin.isTTY === true && process.stdout.isTTY === true
  if (isInteractive) {
    await runSearchTui(opts)
    return
  }
  let results
  try {
    results = await searchModels(opts)
  } catch (err) {
    if (err instanceof HfSearchRateLimitError) {
      warn("Hugging Face search is rate-limited right now (HTTP 429)")
      console.log(dim("hint: wait a bit and retry, lower --limit, or use --mlx / --gguf instead of the default combined search"))
      return
    }
    throw err
  }
  if (results.length === 0) { warn("no results"); return }
  const machine = detectMachineProfile()
  if (opts.sort === "fit") results = sortByFit(results, machine)
  const { mlx, gguf, other } = groupByRuntime(results)
  if (mlx.length) {
    head(`MLX  ${dim(`(${mlx.length})`)}`)
    for (const r of mlx) console.log("  " + formatResultRow(r, buildSearchRecommendation(r, machine)))
    console.log()
  }
  if (gguf.length) {
    head(`GGUF  ${dim(`(${gguf.length}) — llama.cpp`)}`)
    for (const r of gguf) console.log("  " + formatResultRow(r, buildSearchRecommendation(r, machine)))
    console.log()
  }
  if (other.length) {
    head(`other  ${dim(`(${other.length})`)}`)
    for (const r of other) console.log("  " + formatResultRow(r, buildSearchRecommendation(r, machine)))
    console.log()
  }
  console.log(dim("next:"))
  console.log(`  ${style.cyan(sym.arrow)} ${style.bold("athanor pull <repo>")}                 ${dim("# MLX: downloads the whole repo")}`)
  console.log(`  ${style.cyan(sym.arrow)} ${style.bold("athanor pull <repo> --file F.gguf")}   ${dim("# GGUF: pick one file")}`)
}

export async function cmdRouter(opts: { host?: string; port?: number; verbose?: boolean }): Promise<void> {
  const cfg = loadConfig()
  const host = opts.host ?? cfg.router.host
  const port = opts.port ?? cfg.router.port
  const server = startRouter({ host, port, force: true, silent: true, verbose: opts.verbose })
  if (!server) throw new Error("router already running in this process")
  ok(`athanor router listening on ${style.bold(`http://${host}:${port}`)}`)
  info(`exposed models: ${listModels().filter(m => m.publish).length} — ${dim("Ctrl-C to stop")}`)
  await new Promise<void>(resolve => {
    const shutdown = (): void => { void stopRouter().then(resolve) }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  })
}

export async function cmdDoctor(opts: { checkUpdates?: boolean } = {}): Promise<void> {
  const bins = ["mlx_lm.server", "mlx_vlm.server", "llama-server", "hf"]
  head("binaries")
  const widest = Math.max(...bins.map(b => b.length))
  for (const b of bins) {
    const p = await which(b)
    const v = p ? await binaryVersion(b, p) : null
    const update = opts.checkUpdates && v ? await binaryUpdateStatus(b, v) : null
    const mark = p ? style.green(sym.check) : style.red(sym.cross)
    const location = p ? dim(p) : style.red("NOT FOUND")
    const source = b === "llama-server" ? "brew" : "uv"
    const version = v ? `  ${dim("version")} ${v} ${dim(`(${source})`)}` : ""
    const latest = update ? `  ${dim("latest")} ${update.latest}${update.outdated ? ` ${style.yellow("update available")}` : ` ${style.green("up to date")}`}` : ""
    console.log(`  ${mark} ${b.padEnd(widest)}  ${location}${version}${latest}`)
    if (update?.outdated && update.hint) {
      console.log(`  ${" ".repeat(widest + 4)}${dim("hint")} ${update.hint}`)
    }
  }
  console.log()
  head("paths")
  const label = (s: string): string => dim(s.padEnd(8))
  console.log(`  ${label("config")}  ${fs.existsSync(PATHS.config) ? PATHS.config : dim("(default, not written)")}`)
  console.log(`  ${label("registry")}  ${fs.existsSync(PATHS.registry) ? PATHS.registry : dim("(empty)")}`)
  console.log(`  ${label("logs")}  ${PATHS.logsDir}`)
}
