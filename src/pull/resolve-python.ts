import { spawnSync } from "child_process"
import { existsSync, readFileSync } from "fs"

// Finds a Python interpreter that has huggingface_hub importable,
// by reading the shebang of the `hf` console-script shim and
// extracting the interpreter it was installed against. This works
// uniformly across uv tool install, pipx, and pip -- all of them
// produce a shim whose first line points at their venv's python.
//
// Falls back to `python3` on PATH if the shebang is `#!/usr/bin/env
// python3`-style (the interpreter is resolved through env) or if we
// can't read the shim for any reason. The caller is still
// responsible for handling "no huggingface_hub available" -- we
// return null only when no interpreter is resolvable at all.

let cached: string | null | undefined = undefined

function which(name: string): string | null {
  const res = spawnSync("/usr/bin/env", ["which", name], { encoding: "utf8" })
  if (res.status !== 0) return null
  const line = res.stdout.trim().split("\n")[0]
  return line && existsSync(line) ? line : null
}

export function parseShebang(firstLine: string): { kind: "abs"; interpreter: string } | { kind: "env"; name: string } | null {
  if (!firstLine.startsWith("#!")) return null
  const body = firstLine.slice(2).trim()
  if (!body) return null
  const parts = body.split(/\s+/)
  const head = parts[0]
  if (!head) return null
  // `#!/usr/bin/env python3` — follow the env indirection.
  if (head === "/usr/bin/env" || head.endsWith("/env")) {
    const name = parts[1]
    if (!name) return null
    return { kind: "env", name }
  }
  return { kind: "abs", interpreter: head }
}

export function resolvePythonFromShim(shimPath: string): string | null {
  let first: string
  try {
    // Read just enough for the shebang; shim files are text on unix,
    // binaries on Windows (not our target). A few KB is plenty.
    first = readFileSync(shimPath, { encoding: "utf8" }).split("\n")[0] ?? ""
  } catch {
    return null
  }
  const parsed = parseShebang(first)
  if (!parsed) return null
  if (parsed.kind === "abs") {
    return existsSync(parsed.interpreter) ? parsed.interpreter : null
  }
  return which(parsed.name)
}

export function resolvePythonForHf(): string | null {
  if (cached !== undefined) return cached
  const hfShim = which("hf")
  if (hfShim) {
    const py = resolvePythonFromShim(hfShim)
    if (py) {
      cached = py
      return py
    }
  }
  // Last-resort fallback: whatever python3 is on PATH. The caller
  // will get a clean "huggingface_hub not importable" error from the
  // sidecar if this interpreter doesn't actually have it installed.
  const py3 = which("python3")
  cached = py3
  return py3
}

// For tests.
export function _resetResolvePythonCache(): void {
  cached = undefined
}
