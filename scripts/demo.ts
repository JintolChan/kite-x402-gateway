import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runBrowserAudit } from "../src/audit/browser.js";
import { auditInput } from "../src/input.js";
import { fixtureSite } from "../tests/fixtures.js";

const fixture = await fixtureSite();
try {
  const result = await runBrowserAudit(auditInput.parse({ url: "http://fixture.test/broken", checks: { text: ["Ship with evidence."], selectors: ["h1", "#checkout-button"] } }), { proxyFactory: fixture.proxyFactory });
  await mkdir("artifacts/demo", { recursive: true });
  await writeFile("artifacts/demo/report.json", JSON.stringify({ demo: true, payment: "Not performed; local fixture only", ...result }, null, 2));
  await writeFile("artifacts/demo/report.html", result.html);
  for (const viewport of result.report.viewports) await writeFile(`artifacts/demo/${viewport.viewport}.jpg`, Buffer.from(viewport.screenshot.base64, "base64"));
  console.log(JSON.stringify({ mode: "LOCAL DEMO — NO PAYMENT", summary: result.report.summary, report: resolve("artifacts/demo/report.html") }, null, 2));
} finally { await fixture.close(); }
