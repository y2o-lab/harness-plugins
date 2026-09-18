import { spawn } from "node:child_process"

// Bound memory and wall time independently. Keep the tail, where most check
// tools print their actionable summary; never persist raw output in events.
export function runShell(command, cwd, { timeoutMs = 120_000, maxOutputBytes = 8192 } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== "win32", env: { ...process.env, HARNESS_ACTIVE: "1" }, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let outputTruncated = false
    let timedOut = false
    const collect = (previous, chunk) => {
      outputTruncated ||= previous.length + chunk.length > maxOutputBytes
      return Buffer.concat([previous, chunk]).subarray(-maxOutputBytes)
    }
    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk) })
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk) })
    const kill = () => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL")
        else process.kill(-child.pid, "SIGKILL")
      } catch (error) { if (error.code !== "ESRCH") child.kill("SIGKILL") }
    }
    const timer = setTimeout(() => { timedOut = true; kill() }, timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      resolveRun({ exitCode: 1, stdout: stdout.toString(), stderr: error.message, timedOut, outputTruncated })
    })
    child.once("close", (code) => {
      clearTimeout(timer)
      resolveRun({ exitCode: timedOut ? 124 : code ?? 1, stdout: stdout.toString(), stderr: stderr.toString(), timedOut, outputTruncated })
    })
  })
}
