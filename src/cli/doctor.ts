import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"

export interface UpdateStatus {
  latest: string
  outdated: boolean
  hint?: string
}

function capture(cmd: string, args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise(resolve => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] })
    const chunks: Buffer[] = []
    proc.stdout?.on("data", c => chunks.push(c as Buffer))
    proc.on("error", () => resolve({ code: null, stdout: "" }))
    proc.on("exit", code => {
      resolve({ code, stdout: Buffer.concat(chunks).toString("utf8").trim() })
    })
  })
}

export function which(binary: string): Promise<string | null> {
  return capture("which", [binary]).then(({ code, stdout }) => {
    if (code !== 0) return null
    return stdout || null
  })
}

function readMetadataVersion(file: string): string | null {
  try {
    const text = fs.readFileSync(file, "utf8")
    for (const line of text.split(/\r?\n/)) {
      const match = line.trim().match(/^version:\s*(.+)$/i)
      if (match) return match[1].trim()
    }
    return null
  } catch {
    return null
  }
}

function distInfoVersion(sitePackagesDir: string, packageNames: string[]): string | null {
  let names: string[]
  try {
    names = fs.readdirSync(sitePackagesDir)
  } catch {
    return null
  }
  for (const packageName of packageNames) {
    const normalized = packageName.toLowerCase().replace(/[-_.]+/g, "-")
    const prefixes = new Set([
      normalized,
      normalized.replace(/-/g, "_"),
      normalized.replace(/_/g, "-")
    ])
    for (const entry of names) {
      if (!entry.endsWith(".dist-info")) continue
      const lower = entry.toLowerCase()
      const matchesPrefix = [...prefixes].some(prefix => lower.startsWith(prefix))
      if (!matchesPrefix) continue
      const version = readMetadataVersion(path.join(sitePackagesDir, entry, "METADATA"))
      if (version) return version
    }
  }
  return null
}

function pythonVersionDirs(root: string): string[] {
  try {
    return fs.readdirSync(root)
      .filter(name => /^python\d+(?:\.\d+)?$/.test(name))
      .map(name => path.join(root, name))
  } catch {
    return []
  }
}

function uvToolVersion(binaryPath: string, packageNames: string[]): string | null {
  let real: string
  try {
    real = fs.realpathSync(binaryPath)
  } catch {
    return null
  }
  const binDir = path.dirname(real)
  const toolDir = path.dirname(binDir)
  const libDir = path.join(toolDir, "lib")
  for (const pyDir of pythonVersionDirs(libDir)) {
    const sitePackages = path.join(pyDir, "site-packages")
    const version = distInfoVersion(sitePackages, packageNames)
    if (version) return version
  }
  return null
}

function brewCellarVersion(binaryPath: string): string | null {
  try {
    const real = fs.realpathSync(binaryPath)
    const parts = real.split(path.sep).filter(Boolean)
    const cellar = parts.indexOf("Cellar")
    if (cellar < 0 || cellar + 2 >= parts.length) return null
    return parts[cellar + 2] || null
  } catch {
    return null
  }
}

export async function binaryVersion(binary: string, binaryPath: string): Promise<string | null> {
  switch (binary) {
    case "mlx_lm.server":
      return uvToolVersion(binaryPath, ["mlx-lm"])
    case "mlx_vlm.server":
      return uvToolVersion(binaryPath, ["mlx-vlm"])
    case "hf":
      return uvToolVersion(binaryPath, ["huggingface-hub", "huggingface_hub", "hf"])
    case "llama-server":
      return brewCellarVersion(binaryPath)
    default:
      return null
  }
}

function parseVersionTuple(input: string): number[] {
  const nums = input.match(/\d+/g)
  return nums ? nums.map(n => Number(n)) : []
}

function compareVersions(a: string, b: string): number {
  const av = parseVersionTuple(a)
  const bv = parseVersionTuple(b)
  const len = Math.max(av.length, bv.length)
  for (let i = 0; i < len; i += 1) {
    const ai = av[i] ?? 0
    const bi = bv[i] ?? 0
    if (ai !== bi) return ai < bi ? -1 : 1
  }
  return 0
}

async function latestPypiVersion(pkg: string): Promise<string | null> {
  const { code, stdout } = await capture("python3", [
    "-c",
    [
      "import json, urllib.request, sys",
      `url = 'https://pypi.org/pypi/${pkg}/json'`,
      "data = json.load(urllib.request.urlopen(url, timeout=2))",
      "print(data['info']['version'])"
    ].join("; ")
  ])
  if (code !== 0) return null
  return stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? null
}

async function latestBrewVersion(formula: string): Promise<string | null> {
  const { code, stdout } = await capture("brew", ["info", "--json=v2", formula])
  if (code !== 0 || !stdout) return null
  try {
    const data = JSON.parse(stdout) as {
      formulae?: Array<{ versions?: { stable?: string } }>
    }
    return data.formulae?.[0]?.versions?.stable ?? null
  } catch {
    return null
  }
}

export async function binaryUpdateStatus(binary: string, installed: string): Promise<UpdateStatus | null> {
  switch (binary) {
    case "mlx_lm.server": {
      const latest = await latestPypiVersion("mlx-lm")
      return latest ? {
        latest,
        outdated: compareVersions(installed, latest) < 0,
        hint: "uv tool upgrade mlx-lm"
      } : null
    }
    case "mlx_vlm.server": {
      const latest = await latestPypiVersion("mlx-vlm")
      return latest ? {
        latest,
        outdated: compareVersions(installed, latest) < 0,
        hint: "uv tool upgrade mlx-vlm"
      } : null
    }
    case "hf": {
      const latest = await latestPypiVersion("huggingface-hub")
      return latest ? {
        latest,
        outdated: compareVersions(installed, latest) < 0,
        hint: "uv tool upgrade hf"
      } : null
    }
    case "llama-server": {
      const latest = await latestBrewVersion("llama.cpp")
      return latest ? {
        latest,
        outdated: compareVersions(installed, latest) < 0,
        hint: "brew upgrade llama.cpp"
      } : null
    }
    default:
      return null
  }
}
