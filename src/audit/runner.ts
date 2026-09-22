import { fork } from "node:child_process";
import type { AuditInput, AuditResult } from "../input.js";

export type Runner = (input: AuditInput, signal: AbortSignal) => Promise<AuditResult>;
export function createRunner(timeoutMs: number, workerEntry?: URL): Runner {
  return (input, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("AUDIT_ABORTED")); return; }
    const ext = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const child = fork(workerEntry ?? new URL(`./worker.${ext}`, import.meta.url), [], {
      detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore", "ipc"],
      // Do not expose gateway credentials or a developer's full environment to the worker.
      env: Object.fromEntries(["PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "NODE_ENV"].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : [])),
    });
    let finished = false;
    const stop = () => {
      try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already exited */ }
    };
    const finish = (error?: Error, result?: AuditResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); signal.removeEventListener("abort", onAbort); stop();
      if (error) reject(error); else resolve(result!);
    };
    const onAbort = () => finish(new Error("AUDIT_ABORTED"));
    const timer = setTimeout(() => finish(new Error("AUDIT_TIMEOUT")), timeoutMs + 2000);
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", () => finish(new Error("WORKER_START_FAILED")));
    child.once("exit", () => finish(new Error("WORKER_EXITED")));
    child.once("message", (message: { ok: boolean; result?: AuditResult }) => {
      if (message.ok && message.result) finish(undefined, message.result);
      else finish(new Error("BROWSER_EXECUTION_FAILED"));
    });
    child.send({ input, timeoutMs });
  });
}
