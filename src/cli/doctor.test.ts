import { describe, expect, it, vi, afterEach } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { binaryUpdateStatus, binaryVersion, which } from "./doctor.js"
import { spawn } from "child_process"
import { EventEmitter } from "events"

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>()
  return {
    ...actual,
    spawn: vi.fn((cmd, args, opts) => actual.spawn(cmd, args, opts))
  }
})

describe("which", () => {
  it("returns path for an existing binary on PATH", async () => {
    const res = await which("sh")
    expect(res).toBeTruthy()
    expect(typeof res).toBe("string")
  })

  it("returns null for a non-existent binary", async () => {
    const res = await which("non_existent_binary_12345_xyz")
    expect(res).toBeNull()
  })
})

describe("binaryVersion", () => {
  it("resolves python package version from uv tool directory layout", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-doctor-uv-"))
    try {
      const toolDir = path.join(tmp, "uv-tools", "mlx-lm")
      const binDir = path.join(toolDir, "bin")
      const libDir = path.join(toolDir, "lib", "python3.12", "site-packages")
      const distInfo = path.join(libDir, "mlx_lm-0.21.0.dist-info")
      fs.mkdirSync(binDir, { recursive: true })
      fs.mkdirSync(distInfo, { recursive: true })

      const binaryPath = path.join(binDir, "mlx_lm.server")
      fs.writeFileSync(binaryPath, "#!/bin/sh\n")
      fs.writeFileSync(path.join(distInfo, "METADATA"), "Metadata-Version: 2.1\nName: mlx-lm\nVersion: 0.21.0\n")

      return binaryVersion("mlx_lm.server", binaryPath).then(ver => {
        expect(ver).toBe("0.21.0")
      })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("resolves hf and mlx_vlm versions from site-packages", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-doctor-uv2-"))
    try {
      const toolDir = path.join(tmp, "uv-tools", "hf-tool")
      const binDir = path.join(toolDir, "bin")
      const libDir = path.join(toolDir, "lib", "python3.11", "site-packages")
      const distInfo = path.join(libDir, "huggingface_hub-0.29.1.dist-info")
      fs.mkdirSync(binDir, { recursive: true })
      fs.mkdirSync(distInfo, { recursive: true })

      const hfBin = path.join(binDir, "hf")
      fs.writeFileSync(hfBin, "#!/bin/sh\n")
      fs.writeFileSync(path.join(distInfo, "METADATA"), "Name: huggingface-hub\nVersion: 0.29.1\n")

      const ver = await binaryVersion("hf", hfBin)
      expect(ver).toBe("0.29.1")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("resolves llama-server version from homebrew cellar path layout", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-doctor-brew-"))
    try {
      // Create path like <tmp>/Cellar/llama.cpp/b4567/bin/llama-server
      const binDir = path.join(tmp, "Cellar", "llama.cpp", "b4567", "bin")
      fs.mkdirSync(binDir, { recursive: true })
      const binPath = path.join(binDir, "llama-server")
      fs.writeFileSync(binPath, "#!/bin/sh\n")

      const ver = await binaryVersion("llama-server", binPath)
      expect(ver).toBe("b4567")
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("returns null for non-cellar path or malformed cellar path for llama-server", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-doctor-nobrew-"))
    try {
      const binPath = path.join(tmp, "llama-server")
      fs.writeFileSync(binPath, "#!/bin/sh\n")
      const ver = await binaryVersion("llama-server", binPath)
      expect(ver).toBeNull()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("returns null for unknown binary", async () => {
    const ver = await binaryVersion("unknown-binary", "/bin/sh")
    expect(ver).toBeNull()
  })

  it("returns null when binaryPath does not exist", async () => {
    const ver = await binaryVersion("mlx_lm.server", "/nonexistent/path/mlx_lm.server")
    expect(ver).toBeNull()
  })
})

describe("binaryUpdateStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockSpawn(stdout: string, exitCode: number = 0) {
    vi.mocked(spawn).mockImplementation(() => {
      const proc = new EventEmitter() as any
      proc.stdout = new EventEmitter()
      setTimeout(() => {
        if (stdout) proc.stdout.emit("data", Buffer.from(stdout))
        proc.emit("exit", exitCode)
      }, 5)
      return proc
    })
  }

  it("detects outdated mlx_lm.server when PyPI has a newer version", async () => {
    mockSpawn("0.22.0\n", 0)
    const status = await binaryUpdateStatus("mlx_lm.server", "0.21.0")
    expect(status).not.toBeNull()
    expect(status?.latest).toBe("0.22.0")
    expect(status?.outdated).toBe(true)
    expect(status?.hint).toBe("uv tool upgrade mlx-lm")
  })

  it("detects up-to-date mlx_vlm.server when installed version matches PyPI", async () => {
    mockSpawn("0.1.5\n", 0)
    const status = await binaryUpdateStatus("mlx_vlm.server", "0.1.5")
    expect(status).not.toBeNull()
    expect(status?.latest).toBe("0.1.5")
    expect(status?.outdated).toBe(false)
    expect(status?.hint).toBe("uv tool upgrade mlx-vlm")
  })

  it("detects hf status", async () => {
    mockSpawn("0.30.0\n", 0)
    const status = await binaryUpdateStatus("hf", "0.29.0")
    expect(status?.outdated).toBe(true)
    expect(status?.hint).toBe("uv tool upgrade hf")
  })

  it("detects llama-server status from brew info JSON", async () => {
    const brewJson = JSON.stringify({
      formulae: [{ versions: { stable: "b5000" } }]
    })
    mockSpawn(brewJson, 0)
    const status = await binaryUpdateStatus("llama-server", "b4000")
    expect(status?.latest).toBe("b5000")
    expect(status?.outdated).toBe(true)
    expect(status?.hint).toBe("brew upgrade llama.cpp")
  })

  it("returns null when spawn fails or exits with non-zero code", async () => {
    mockSpawn("", 1)
    const status = await binaryUpdateStatus("mlx_lm.server", "0.21.0")
    expect(status).toBeNull()
  })

  it("returns null for unknown binary", async () => {
    const status = await binaryUpdateStatus("custom_binary", "1.0.0")
    expect(status).toBeNull()
  })
})
