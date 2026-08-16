import {
  cmdConfig,
  cmdDoctor,
  cmdExpose,
  cmdFlavor,
  cmdList,
  cmdLogs,
  cmdPresetApply,
  cmdPresetClear,
  cmdPresetSave,
  cmdPresetSet,
  cmdPresetShow,
  cmdPresetUnset,
  cmdPull,
  cmdRecipes,
  cmdRestart,
  cmdRm,
  cmdRouter,
  cmdScan,
  cmdSearch,
  cmdShow,
  cmdSnippet,
  cmdStart,
  cmdStatus,
  cmdStop,
  cmdSync,
  cmdTelemetry
} from "./commands.js"
import type { SearchFilter, SearchSort } from "../search/hf.js"
import { style } from "./style.js"

function usage(): void {
  const rows: Array<[string, string, string]> = [
    ["scan",       "",                               "re-scan model dirs and update registry"],
    ["ls",         "",                               "list registry"],
    ["status",     "",                               "list running instances"],
    ["show",       "<id|slug>",                      "inspect a model (config, command, state)"],
    ["snippet",    "<id|slug>",                      "generate integration code snippets"],
    ["start",      "<id|slug>",                      "start a model"],
    ["stop",       "[<id|slug>|--all]",              "stop one or all"],
    ["restart",    "<id|slug>",                      ""],
    ["logs",       "<id|slug> [-n N]",               "tail N lines (default 200)"],
    ["pull",       "<repo> [--file F] [--revision R]", ""],
    ["search",     "[q] [--mlx|--gguf] [--author A] [--sort S] [--limit N]", "find models on HuggingFace"],
    ["trending",   "[--mlx|--gguf] [--limit N]",     "top trending MLX/GGUF models"],
    ["preset",     "<slug> show|set k=v...|unset k...|clear|apply <recipe>", "tune a model"],
    ["recipes",    "",                               "list built-in and user recipes + tunable keys"],
    ["flavor",     "<slug> lm|vlm",                  "force MLX runtime flavor (lm = mlx_lm, vlm = mlx_vlm)"],
    ["expose",     "<id|slug>",                      "include in pi-agent catalog"],
    ["hide",       "<id|slug>",                      "remove from pi-agent catalog"],
    ["rm",         "<id|slug>",                      "remove from registry (must be stopped)"],
    ["sync",       "",                               "manually rewrite pi catalog"],
    ["router",     "[--host H] [--port P] [--verbose]",   "run the athanor ingress server in the foreground"],
    ["config",     "",                               "print config and its path"],
    ["doctor",     "[--check-updates]",              "check for required binaries and versions"],
    ["telemetry",  "[<slug>|compare|clear]",         "display performance metrics and historical telemetry"],
    ["(no args)",  "",                               "launch the TUI"]
  ]
  const cw = Math.max(...rows.map(r => r[0].length))
  const aw = Math.max(...rows.map(r => r[1].length))
  console.log()
  console.log(`  ${style.bold("athanor")} ${style.gray("— local LLM workbench")}`)
  console.log()
  console.log(`  ${style.bold("Commands")}`)
  for (const [cmd, args, desc] of rows) {
    const left  = style.cyan(cmd.padEnd(cw))
    const mid   = args.padEnd(aw)
    const right = desc ? style.gray(desc) : ""
    console.log(`    ${left}  ${mid}  ${right}`.trimEnd())
  }
  console.log()
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  return args[i + 1]
}

export async function runCli(argv: string[]): Promise<boolean> {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case undefined:
      return false
    case "scan":        await cmdScan(); return true
    case "ls":          await cmdList(); return true
    case "status":      await cmdStatus(); return true
    case "start":       await cmdStart(required(rest[0], "id|slug")); return true
    case "stop":        await cmdStop(rest[0]); return true
    case "restart":     await cmdRestart(required(rest[0], "id|slug")); return true
    case "logs": {
      const id = required(rest[0], "id|slug")
      const n = Number(getFlag(rest, "-n") ?? 200)
      await cmdLogs(id, Number.isFinite(n) ? n : 200)
      return true
    }
    case "pull": {
      const repo = required(rest[0], "repo")
      const file = getFlag(rest, "--file")
      const revision = getFlag(rest, "--revision")
      await cmdPull(repo, file, revision); return true
    }
    case "search":
      await cmdSearch(parseSearchOpts(rest)); return true
    case "trending":
      await cmdSearch({ ...parseSearchOpts(rest), sort: "trending" }); return true
    case "show":        cmdShow(required(rest[0], "id|slug")); return true
    case "snippet":     cmdSnippet(required(rest[0], "id|slug")); return true
    case "recipes":     cmdRecipes(); return true
    case "preset": {
      const slug = required(rest[0], "id|slug")
      const sub = required(rest[1], "show|set|unset|clear|apply|save")
      const tail = rest.slice(2)
      switch (sub) {
        case "show":   cmdPresetShow(slug); return true
        case "set":    cmdPresetSet(slug, tail); return true
        case "unset":  cmdPresetUnset(slug, tail); return true
        case "clear":  cmdPresetClear(slug); return true
        case "apply":  cmdPresetApply(slug, required(tail[0], "recipe")); return true
        case "save":
        case "save-recipe":
          cmdPresetSave(slug, required(tail[0], "recipe-name"), tail[1])
          return true
        default:
          console.error(`${style.red("✗")} unknown preset subcommand: ${style.bold(sub)}`)
          process.exit(1)
      }
      return true
    }
    case "expose":      cmdExpose(required(rest[0], "id|slug"), true); return true
    case "hide":        cmdExpose(required(rest[0], "id|slug"), false); return true
    case "flavor":      cmdFlavor(required(rest[0], "id|slug"), required(rest[1], "lm|vlm")); return true
    case "rm":          cmdRm(required(rest[0], "id|slug")); return true
    case "sync":        await cmdSync(); return true
    case "router": {
      const host = getFlag(rest, "--host")
      const portRaw = getFlag(rest, "--port")
      const port = portRaw ? Number(portRaw) : undefined
      if (portRaw && !Number.isFinite(port)) {
        console.error(`${style.red("✗")} --port must be a number, got ${style.bold(portRaw)}`)
        process.exit(1)
      }
      await cmdRouter({ host, port, verbose: rest.includes("--verbose") })
      return true
    }
    case "config":      cmdConfig(); return true
    case "doctor":      await cmdDoctor({ checkUpdates: rest.includes("--check-updates") }); return true
    case "telemetry":   await cmdTelemetry(rest); return true
    case "help":
    case "--help":
    case "-h":
      usage(); return true
    default:
      console.error(`${style.red("✗")} unknown command: ${style.bold(cmd)}`)
      usage()
      process.exit(1)
  }
}

function required(v: string | undefined, name: string): string {
  if (!v) {
    console.error(`${style.red("✗")} missing required argument: ${style.bold(name)}`)
    process.exit(1)
  }
  return v
}

function parseSearchOpts(rest: string[]): {
  query?: string
  filter?: SearchFilter
  author?: string
  sort?: SearchSort
  limit?: number
} {
  const args = rest.slice()
  let filter: SearchFilter | undefined
  if (args.includes("--mlx"))  { filter = "mlx";  args.splice(args.indexOf("--mlx"), 1) }
  if (args.includes("--gguf")) { filter = "gguf"; args.splice(args.indexOf("--gguf"), 1) }
  if (args.includes("--any"))  { filter = "any";  args.splice(args.indexOf("--any"), 1) }
  const author = getFlag(args, "--author")
  const sortRaw = getFlag(args, "--sort")
  const limitRaw = getFlag(args, "--limit")
  const sort = (["downloads", "likes", "trending", "modified", "size", "fit"] as const)
    .find(s => s === sortRaw) as SearchSort | undefined
  const limit = limitRaw ? Number(limitRaw) : undefined
  // Remaining positional tokens (not following a consumed flag) form
  // the free-text query. Skip values we already consumed as flag args.
  const consumed = new Set<string>()
  for (const flag of ["--author", "--sort", "--limit"]) {
    const i = args.indexOf(flag)
    if (i >= 0 && args[i + 1]) { consumed.add(`${i}`); consumed.add(`${i + 1}`) }
  }
  const positional = args.filter((_, i) => !consumed.has(`${i}`) && !args[i - 1]?.startsWith("--"))
    .filter(a => !a.startsWith("--"))
  const query = positional.join(" ").trim() || undefined
  return {
    query,
    filter,
    author,
    sort,
    limit: Number.isFinite(limit) && limit! > 0 ? limit : undefined
  }
}
