import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { parseShebang, resolvePythonFromShim } from "./resolve-python.js"

describe("parseShebang", () => {
  it("returns null for non-shebang input", () => {
    expect(parseShebang("")).toBeNull()
    expect(parseShebang("print('hi')")).toBeNull()
    expect(parseShebang("#")).toBeNull()
  })

  it("parses absolute-interpreter shebangs", () => {
    expect(parseShebang("#!/usr/bin/python3"))
      .toEqual({ kind: "abs", interpreter: "/usr/bin/python3" })
    expect(parseShebang("#!/Users/me/.local/share/uv/tools/huggingface-hub/bin/python3"))
      .toEqual({ kind: "abs", interpreter: "/Users/me/.local/share/uv/tools/huggingface-hub/bin/python3" })
  })

  it("recognises `#!/usr/bin/env NAME` as env indirection", () => {
    expect(parseShebang("#!/usr/bin/env python3"))
      .toEqual({ kind: "env", name: "python3" })
    expect(parseShebang("#!/usr/bin/env python"))
      .toEqual({ kind: "env", name: "python" })
  })

  it("handles leading whitespace and extra args", () => {
    // Some installers write `#!/path/to/python -u` — we should only
    // return the interpreter path, ignoring trailing flags.
    expect(parseShebang("#!/opt/homebrew/bin/python3 -u"))
      .toEqual({ kind: "abs", interpreter: "/opt/homebrew/bin/python3" })
  })

  it("returns null for env shebang with no interpreter name", () => {
    expect(parseShebang("#!/usr/bin/env")).toBeNull()
  })
})

describe("resolvePythonFromShim", () => {
  it("returns the interpreter named in an abs-path shebang if it exists", () => {
    // Point at an interpreter we know is installed on this box: the
    // one running vitest itself. Resolve it through argv0 of the
    // current process via /usr/bin/env; good enough for a smoke test.
    const real = process.execPath   // node itself — not a python, but
                                    // existsSync is all we check here.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-shim-"))
    const shim = path.join(tmp, "fake-hf")
    fs.writeFileSync(shim, `#!${real}\n# rest of file\n`, "utf8")
    expect(resolvePythonFromShim(shim)).toBe(real)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("returns null when the abs interpreter doesn't exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-shim-"))
    const shim = path.join(tmp, "fake-hf")
    fs.writeFileSync(shim, "#!/nonexistent/python-does-not-exist\n", "utf8")
    expect(resolvePythonFromShim(shim)).toBeNull()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("returns null when the shim is unreadable", () => {
    expect(resolvePythonFromShim("/nonexistent/path/to/shim")).toBeNull()
  })

  it("returns null when the shim has no shebang", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "athanor-shim-"))
    const shim = path.join(tmp, "no-shebang")
    fs.writeFileSync(shim, "print('hi')\n", "utf8")
    expect(resolvePythonFromShim(shim)).toBeNull()
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
