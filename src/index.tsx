#!/usr/bin/env node

import * as fs from "fs"
import React from "react"
import { render } from "ink"
import App from "./ui/App.js"
import { runCli } from "./cli/index.js"
import { ensureBaseDirs } from "./config/index.js"
import { startControlApi, stopControlApi } from "./control/server.js"
import { startRouter, stopRouter } from "./router/server.js"
import { ingestDiscovered } from "./discovery/ingest.js"
import { reconcileRouterForCurrentState } from "./router/lifecycle.js"

const ENTER_ALT_SCREEN = "\x1b[?1049h"
const LEAVE_ALT_SCREEN = "\x1b[?1049l"
const CLEAR_SCREEN = "\x1b[2J\x1b[H"
const HIDE_CURSOR = "\x1b[?25l"
const SHOW_CURSOR = "\x1b[?25h"
const DEV_LOG = "/tmp/athanor-dev.log"

function devLog(message: string): void {
  if (process.env.ATHANOR_DEV_TUI !== "1") return
  try {
    fs.appendFileSync(DEV_LOG, `[${Date.now()}] pid=${process.pid} ${message}\n`)
  } catch {
    // best-effort only; never fail startup/shutdown on dev logging
  }
}

async function main(): Promise<void> {
  ensureBaseDirs()
  const devTui = process.env.ATHANOR_DEV_TUI === "1"
  devLog("start")
  const args = process.argv.slice(2)
  if (args[0] === "__router_service") {
    startRouter({ force: true, silent: true })
    await new Promise<void>(resolve => {
      const shutdown = (): void => { void stopRouter().then(resolve) }
      process.once("SIGINT", shutdown)
      process.once("SIGTERM", shutdown)
    })
    return
  }

  const handled = await runCli(args)
  if (handled) return

  if (!process.stdin.isTTY) {
    console.error("athanor: requires an interactive terminal. Run it directly — not piped or in CI.")
    process.exit(1)
  }

  // Always scan on start so out-of-band `hf download` calls (and any
  // model added while the TUI was closed) are picked up without the
  // user having to press `s`. ingestDiscovered is idempotent; when
  // nothing changed it's a no-op write.
  const rep = ingestDiscovered()
  let initialMessage: string | undefined
  if (rep.added.length > 0) {
    initialMessage = `scanned: +${rep.added.length} new model${rep.added.length === 1 ? "" : "s"}`
  }
  // Empty-registry hint is handled inline by the Suggestions picker
  // in App.tsx, so no toast here.

  startControlApi()
  reconcileRouterForCurrentState()

  if (!devTui) process.stdout.write(ENTER_ALT_SCREEN + CLEAR_SCREEN + HIDE_CURSOR)
  else process.stdout.write(CLEAR_SCREEN)
  const restore = (): void => {
    if (!devTui) process.stdout.write(SHOW_CURSOR + LEAVE_ALT_SCREEN)
  }

  const instance = render(<App initialMessage={initialMessage} />, {
    exitOnCtrlC: true
  })

  const stopServers = async (): Promise<void> => {
    await Promise.allSettled([stopControlApi(), stopRouter()])
  }

  const shutdown = async (reason: "SIGINT" | "SIGTERM"): Promise<void> => {
    devLog(`shutdown ${reason}`)
    instance.unmount()
    await stopServers()
    restore()
    process.exit(0)
  }
  process.on("SIGINT", () => { void shutdown("SIGINT") })
  process.on("SIGTERM", () => { void shutdown("SIGTERM") })
  instance.waitUntilExit().then(() => {
    devLog("exit ink")
    stopServers().finally(() => { restore(); process.exit(0) })
  })
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  const red = process.stdout.isTTY && !process.env.NO_COLOR
    ? `\x1b[31m✗\x1b[39m` : "✗"
  console.error(`${red} ${msg}`)
  process.exit(1)
})
