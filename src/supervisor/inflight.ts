// In-memory ref-count of router-proxied requests per model id. The
// router calls begin() when it opens an upstream fetch and end() in a
// finally block. supervisor.stop() consults awaitIdle() before SIGTERM
// so an active SSE stream isn't cut mid-token. Counts live in-process
// only — nothing is persisted. If the router isn't running (or never
// sees traffic for a given id), awaitIdle resolves immediately.

interface Slot {
  count: number
  waiters: Array<() => void>
}

const slots = new Map<string, Slot>()

function slotFor(id: string): Slot {
  let s = slots.get(id)
  if (!s) { s = { count: 0, waiters: [] }; slots.set(id, s) }
  return s
}

export function begin(id: string): void {
  slotFor(id).count++
}

export function end(id: string): void {
  const s = slots.get(id)
  if (!s) return
  s.count = Math.max(0, s.count - 1)
  if (s.count === 0) {
    const waiters = s.waiters.splice(0)
    slots.delete(id)
    for (const w of waiters) w()
  }
}

export function inflight(id: string): number {
  return slots.get(id)?.count ?? 0
}

// Resolves when the count for `id` reaches 0 or `timeoutMs` elapses.
// Returns true if drained cleanly, false if the timeout fired.
export function awaitIdle(id: string, timeoutMs: number): Promise<boolean> {
  const s = slots.get(id)
  if (!s || s.count === 0) return Promise.resolve(true)
  if (timeoutMs <= 0) return Promise.resolve(false)
  return new Promise(resolve => {
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      const i = s.waiters.indexOf(waiter)
      if (i >= 0) s.waiters.splice(i, 1)
      resolve(ok)
    }
    const waiter = (): void => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    s.waiters.push(waiter)
  })
}

// Test helper. Not used in production code paths.
export function _reset(): void {
  for (const s of slots.values()) for (const w of s.waiters.splice(0)) w()
  slots.clear()
}
