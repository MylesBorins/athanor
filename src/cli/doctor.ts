import { spawn } from "child_process"

export function which(binary: string): Promise<string | null> {
  return new Promise(resolve => {
    const proc = spawn("which", [binary], { stdio: ["ignore", "pipe", "ignore"] })
    const chunks: Buffer[] = []
    proc.stdout?.on("data", c => chunks.push(c as Buffer))
    proc.on("error", () => resolve(null))
    proc.on("exit", code => {
      if (code !== 0) return resolve(null)
      const out = Buffer.concat(chunks).toString("utf8").trim()
      resolve(out || null)
    })
  })
}
