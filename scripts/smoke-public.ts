import { mkdir, writeFile } from "node:fs/promises";
import { createRunner } from "../src/audit/runner.js";
import { auditInput } from "../src/input.js";

// Explicit opt-in public-site smoke test; no payment or wallet is involved.
const input = auditInput.parse({ url: process.argv[2] ?? "https://example.com", viewports: ["desktop", "mobile"], checks: { selectors: ["h1"] } });
const result = await createRunner(30000)(input, new AbortController().signal);
await mkdir("artifacts/public-smoke", { recursive: true });
await writeFile("artifacts/public-smoke/report.html", result.html);
await writeFile("artifacts/public-smoke/report.json", JSON.stringify({ payment: "Not performed; browser worker smoke test only", ...result }, null, 2));
console.log(JSON.stringify({ outcome: result.report.outcome, summary: result.report.summary, worker: "child process", payment: "none" }));
