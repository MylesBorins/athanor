import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const srcDir = path.join(root, 'src')

let child = null
let restartTimer = null
let restarting = false
let shuttingDown = false

function stopChild(signal = 'SIGTERM') {
  if (!child) return
  try { child.kill(signal) } catch { /* already gone */ }
}

function startChild() {
  child = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/index.tsx'],
    {
      stdio: 'inherit',
      env: { ...process.env, ATHANOR_DEV_TUI: '1' }
    }
  )

  child.on('exit', () => {
    child = null
    if (shuttingDown) return
    if (restarting) {
      restarting = false
      startChild()
    }
  })
}

function scheduleRestart() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    if (!child) {
      startChild()
      return
    }
    restarting = true
    stopChild('SIGTERM')
  }, 75)
}

function watchTree(dir) {
  watch(dir, { recursive: true }, (_eventType, filename) => {
    if (!filename) return
    if (!/\.(ts|tsx)$/.test(filename)) return
    scheduleRestart()
  })
}

startChild()
watchTree(srcDir)

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    shuttingDown = true
    clearTimeout(restartTimer)
    stopChild(sig)
    setTimeout(() => {
      stopChild('SIGKILL')
      process.exit(0)
    }, 150)
  })
}

process.on('exit', () => {
  shuttingDown = true
  clearTimeout(restartTimer)
  stopChild('SIGTERM')
})
