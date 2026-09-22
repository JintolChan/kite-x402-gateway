import { auditInput } from "../input.js";
import { runBrowserAudit } from "./browser.js";

process.once("message", async (message: { input: unknown; timeoutMs: number }) => {
  try {
    const result = await runBrowserAudit(auditInput.parse(message.input), { timeoutMs: message.timeoutMs });
    process.send?.({ ok: true, result }, () => process.exit(0));
  } catch {
    process.send?.({ ok: false }, () => process.exit(1));
  }
});
