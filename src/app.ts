import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import pino from "pino";
import type { Config } from "./config.js";
import { auditInput } from "./input.js";
import type { Runner } from "./audit/runner.js";
import { resolvePublicTarget } from "./security/target.js";

export function createApp(config: Config, deps: {
  payment: RequestHandler;
  run: Runner;
  validateTarget?: (url: string) => Promise<unknown>;
  logger?: ReturnType<typeof pino>;
}) {
  const app = express();
  const logger = deps.logger ?? pino();
  let active = false;
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.get("/healthz", (_req, res) => res.json({ ok: true, busy: active, network: config.KITE_NETWORK, priceUsd: config.PRICE_USD }));
  app.get("/", (_req, res) => res.json({
    service: "Kite Web Check", version: "0.1.0", endpoint: "POST /v1/audits", priceUsd: config.PRICE_USD,
    billing: "Payment is settled after a report is generated, even when checks find defects. Browser execution failures do not request settlement.",
    scope: "Public pages only, Chromium desktop/mobile viewports, no login or form submission. Reports returned inline, not stored.",
    example: { url: "https://example.com", viewports: ["desktop", "mobile"], checks: { text: ["Example Domain"], selectors: ["h1"] } },
  }));
  app.use(express.json({ limit: "8kb", strict: true }));
  app.post("/v1/audits", async (req, res, next) => {
    const parsed = auditInput.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_INPUT", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }); return; }
    if (active) { res.setHeader("Retry-After", "5"); res.status(503).json({ error: "BUSY", message: "One test is already running. Retry later." }); return; }
    active = true;
    let handlerRunning = false;
    const controller = new AbortController();
    const release = () => { if (!handlerRunning) active = false; };
    res.once("finish", release);
    res.once("close", () => { controller.abort(); release(); });
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.locals.input = parsed.data;
    res.locals.signal = controller.signal;
    res.locals.startRun = () => { handlerRunning = true; };
    res.locals.endRun = () => { handlerRunning = false; if (res.destroyed || res.writableFinished) active = false; };
    try {
      // DNS preflight is bounded; the browser proxy resolves and pins again at connection time.
      await Promise.race([
        (deps.validateTarget ?? resolvePublicTarget)(parsed.data.url),
        new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Target validation timeout")), 4000); timer.unref(); }),
      ]);
      if (controller.signal.aborted) { res.status(499).json({ error: "CLIENT_DISCONNECTED" }); return; }
      next();
    } catch { res.status(400).json({ error: "TARGET_NOT_ALLOWED", message: "Target must resolve to a public HTTP(S) address on port 80 or 443." }); }
  }, deps.payment, async (_req, res) => {
    res.locals.startRun();
    try {
      const result = await deps.run(res.locals.input, res.locals.signal);
      if (res.locals.signal.aborted) { res.status(499).json({ error: "CLIENT_DISCONNECTED" }); return; }
      logger.info({ requestId: res.getHeader("X-Request-Id"), outcome: result.report.outcome, durationMs: result.report.durationMs }, "audit completed");
      res.status(200).json(result);
    } catch {
      logger.warn({ requestId: res.getHeader("X-Request-Id") }, "audit execution failed");
      res.status(502).json({ error: "AUDIT_EXECUTION_FAILED", message: "The report could not be completed. Settlement was not requested." });
    } finally { res.locals.endRun(); }
  });
  app.use((_req, res) => { res.status(404).json({ error: "NOT_FOUND" }); });
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    if (!res.headersSent) res.status(err?.type === "entity.too.large" ? 413 : err instanceof SyntaxError ? 400 : 500).json({ error: "REQUEST_FAILED" });
  };
  app.use(errors);
  return app;
}
