import * as fs from "fs"
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { cmdSnippet } from "./snippet-commands.js"
import { upsertModel } from "../registry/index.js"
import { PATHS } from "../config/index.js"
import type { ModelEntry } from "../types/index.js"

function mlxEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: "x/y",
    slug: "y",
    path: "/m/y",
    runtime: "mlx",
    source: { type: "hf", repo: "x/y" },
    port: 8081,
    publish: true,
    piAlias: "y",
    addedAt: 1,
    mlxFlavor: "lm",
    ...overrides
  }
}

describe("cmdSnippet", () => {
  beforeEach(() => {
    try { fs.unlinkSync(PATHS.registry) } catch { /* not present */ }
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("prints snippet template details for a valid model", () => {
    upsertModel(mlxEntry())
    cmdSnippet("y")
    
    const calls = vi.mocked(console.log).mock.calls.map(args => args[0] as string);
    const output = calls.join("\n");
    
    expect(output).toContain("integration snippets: y")
    expect(output).toContain("cURL (Bash)")
    expect(output).toContain("Python (openai SDK)")
    expect(output).toContain("pi-agent custom provider block")
    expect(output).toContain("http://127.0.0.1:8081/v1")
    expect(output).toContain("custom-y")
  })

  it("exits process and logs error on unknown model", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("process.exit") }) as any)
    expect(() => cmdSnippet("nonexistent")).toThrow("process.exit")
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("unknown model: nonexistent"))
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
