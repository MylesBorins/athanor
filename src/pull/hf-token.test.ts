import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { _resetTokenCache, hfHeaders, readHfToken } from "./hf-token.js"

describe("readHfToken and hfHeaders", () => {
  const origHfToken = process.env.HF_TOKEN
  const origHubToken = process.env.HUGGING_FACE_HUB_TOKEN
  const tokenDir = path.join(os.homedir(), ".cache", "huggingface")
  const tokenFile = path.join(tokenDir, "token")
  let createdTokenFile = false

  beforeEach(() => {
    _resetTokenCache()
    delete process.env.HF_TOKEN
    delete process.env.HUGGING_FACE_HUB_TOKEN
  })

  afterEach(() => {
    _resetTokenCache()
    if (origHfToken !== undefined) process.env.HF_TOKEN = origHfToken
    else delete process.env.HF_TOKEN

    if (origHubToken !== undefined) process.env.HUGGING_FACE_HUB_TOKEN = origHubToken
    else delete process.env.HUGGING_FACE_HUB_TOKEN

    if (createdTokenFile) {
      try { fs.unlinkSync(tokenFile) } catch {}
      createdTokenFile = false
    }
  })

  it("resolves token from HF_TOKEN env var", () => {
    process.env.HF_TOKEN = "  hf_env_token_123  "
    expect(readHfToken()).toBe("hf_env_token_123")
    expect(hfHeaders()).toEqual({
      Accept: "application/json",
      Authorization: "Bearer hf_env_token_123"
    })
    // Test cache hit
    delete process.env.HF_TOKEN
    expect(readHfToken()).toBe("hf_env_token_123")
  })

  it("resolves token from legacy HUGGING_FACE_HUB_TOKEN env var", () => {
    process.env.HUGGING_FACE_HUB_TOKEN = "hf_legacy_token_456"
    expect(readHfToken()).toBe("hf_legacy_token_456")
  })

  it("returns undefined if env token is empty string or whitespace", () => {
    process.env.HF_TOKEN = "   "
    expect(readHfToken()).toBeUndefined()
  })

  it("reads token from ~/.cache/huggingface/token when env vars are missing", () => {
    fs.mkdirSync(tokenDir, { recursive: true })
    fs.writeFileSync(tokenFile, "  hf_file_token_789  \n", "utf8")
    createdTokenFile = true

    expect(readHfToken()).toBe("hf_file_token_789")
  })

  it("returns undefined when token file is empty or whitespace", () => {
    fs.mkdirSync(tokenDir, { recursive: true })
    fs.writeFileSync(tokenFile, "   \n", "utf8")
    createdTokenFile = true

    expect(readHfToken()).toBeUndefined()
    expect(hfHeaders()).toEqual({ Accept: "application/json" })
  })

  it("returns undefined when token file does not exist", () => {
    try { fs.unlinkSync(tokenFile) } catch {}
    expect(readHfToken()).toBeUndefined()
    expect(hfHeaders()).toEqual({ Accept: "application/json" })
  })
})
