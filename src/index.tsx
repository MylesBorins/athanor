#!/usr/bin/env node

import React from "react"
import { render } from "ink"
import App from "./ui/App.js"
import { runCli } from "./cli/index.js"
import { ensureBaseDirs } from "./config/index.js"
import { startControlApi, stopControlApi } from "./control/server.js"
import { startRouter, stopRouter } from "./router/server.js"
import { listModels } from "./registry/index.js"
import { ingestDiscovered } from "./discovery/ingest.js"

const ENTER_ALT_SCREEN = "\x1b[?1049h"
const LEAVE_ALT_SCREEN = "\x1b[?1049l"
const CLEAR_SCREEN = "\x1b[2J\x1b[H"
const HIDE_CURSOR = "\x1b[?25l"
const SHOW_CURSOR = "\x1b[?25h"

async function main(): Promise<void> {
  ensureBaseDirs()
  const args = process.argv.slice(2)
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
  } else if (listModels().length === 0) {
    initialMessage = "no models found on disk — press p to pull one"
  }

  startControlApi()
  startRouter()

  process.stdout.write(ENTER_ALT_SCREEN + CLEAR_SCREEN + HIDE_CURSOR)
  const restore = (): void => {
    process.stdout.write(SHOW_CURSOR + LEAVE_ALT_SCREEN)
  }

  const instance = render(<App initialMessage={initialMessage} />, {
    exitOnCtrlC: true
  })

  const stopServers = async (): Promise<void> => {
    await Promise.allSettled([stopControlApi(), stopRouter()])
  }

  const shutdown = async (): Promise<void> => {
    instance.unmount()
    await stopServers()
    restore()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
  instance.waitUntilExit().then(() => {
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
