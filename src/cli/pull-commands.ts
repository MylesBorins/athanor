import { pullModel } from "../app/models.js"
import { PullAbortedError } from "../pull/download.js"
import { style, sym } from "./style.js"
import { makeCliPullRenderer } from "./pull-renderer.js"
import { warn, dim, ok } from "./shared.js"

export async function cmdPull(repo: string, file?: string, revision?: string): Promise<void> {
  // The pull sidecar emits structured ProgressEvents; we render a
  // single carriage-return-updated line to stdout so the terminal
  // shows a clean rewriting bar instead of scrollback.
  //
  // SIGINT/SIGTERM trigger an explicit abort. Ctrl-C normally reaches
  // the whole foreground group, but the sidecar's Python doesn't
  // always clean up before Node exits, which could orphan it.
  // Aborting explicitly SIGTERMs the child and escalates to SIGKILL
  // after a grace window.
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
    const render = makeCliPullRenderer()
    const res = await pullModel({
      repo, file, revision,
      signal: ctl.signal,
      onEvent: render.onEvent
    })
    render.finish()
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
