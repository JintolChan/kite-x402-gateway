import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import type { FacilitatorClient } from "@x402/core/server";
import { createPayment } from "../src/payment/middleware.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import type { AuditResult } from "../src/input.js";

const config = readConfig({ PAY_TO: "0x1111111111111111111111111111111111111111" });
const body = { url: "https://example.com", viewports: ["desktop"] };
const result: AuditResult = { report: { id: "test-report", url: body.url, createdAt: "2026-09-20T00:00:00Z", durationMs: 10, outcome: "issues_found", summary: { passed: 0, failed: 1, unknown: 0 }, limitations: [], viewports: [] }, html: "<h1>Issues found</h1>" };
function setup({ valid = true, settle = true, crash = false, settleThrows = false } = {}) {
  const events: string[] = [];
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:2368" }], extensions: [], signers: {} }),
    verify: async () => { events.push("verify"); return { isValid: valid, payer: config.PAY_TO, ...(valid ? {} : { invalidReason: "invalid_signature" }) }; },
    settle: async () => { events.push("settle"); if (settleThrows) throw new Error("simulated facilitator failure"); return { success: settle, network: "eip155:2368", transaction: settle ? `0x${"a".repeat(64)}` : "", payer: config.PAY_TO, ...(settle ? {} : { errorReason: "settlement_failed" }) }; },
  };
  const run = vi.fn(async () => { events.push("run"); if (crash) throw new Error("browser crashed"); return result; });
  const app = createApp(config, { payment: createPayment(config, facilitator), run, validateTarget: async () => {}, logger: pino({ enabled: false }) });
  return { app, events, run };
}
async function signature(app: ReturnType<typeof createApp>) {
  const challenge = await request(app).post("/v1/audits").send(body).expect(402);
  const required = JSON.parse(Buffer.from(challenge.headers["payment-required"]!, "base64").toString());
  // Deliberately synthetic authorization. The injected facilitator is a test double.
  return Buffer.from(JSON.stringify({ x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { signature: "0xtest", authorization: { from: config.PAY_TO, to: config.PAY_TO, value: required.accepts[0].amount, validAfter: "0", validBefore: "9999999999", nonce: `0x${"0".repeat(64)}` } } })).toString("base64");
}
describe("official x402 middleware with a simulated facilitator", () => {
  it("returns Kite testnet 402 without running or settling", async () => {
    const { app, events } = setup();
    const response = await request(app).post("/v1/audits").send(body).expect(402);
    const required = JSON.parse(Buffer.from(response.headers["payment-required"]!, "base64").toString());
    expect(required.accepts[0]).toMatchObject({ network: "eip155:2368", amount: "10000000000000000", payTo: config.PAY_TO });
    expect(events).toEqual([]);
  });
  it("settles after a completed defect report and returns a receipt", async () => {
    const { app, events } = setup();
    const sig = await signature(app);
    const response = await request(app).post("/v1/audits").set("PAYMENT-SIGNATURE", sig).send(body).expect(200);
    expect(events).toEqual(["verify", "run", "settle"]);
    expect(response.body.report.outcome).toBe("issues_found");
    expect(response.headers["payment-response"]).toBeTruthy();
  });
  it("never runs or settles invalid payment", async () => {
    const { app, events } = setup({ valid: false });
    await request(app).post("/v1/audits").set("PAYMENT-SIGNATURE", await signature(app)).send(body).expect(402);
    expect(events).toEqual(["verify"]);
  });
  it("does not settle browser execution failure", async () => {
    const { app, events } = setup({ crash: true });
    await request(app).post("/v1/audits").set("PAYMENT-SIGNATURE", await signature(app)).send(body).expect(502);
    expect(events).toEqual(["verify", "run"]);
  });
  it("withholds the report when settlement fails", async () => {
    const { app, events } = setup({ settle: false });
    const response = await request(app).post("/v1/audits").set("PAYMENT-SIGNATURE", await signature(app)).send(body);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.report).toBeUndefined();
    expect(events).toEqual(["verify", "run", "settle"]);
  });
  it("does not retry or leak the report on a settlement exception", async () => {
    const { app, events } = setup({ settleThrows: true });
    const response = await request(app).post("/v1/audits").set("PAYMENT-SIGNATURE", await signature(app)).send(body);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.body.report).toBeUndefined();
    expect(events.filter((event) => event === "settle")).toHaveLength(1);
  });
  it("rejects malformed inputs before payment or execution", async () => {
    const { app, events } = setup();
    await request(app).post("/v1/audits").send({ url: "file:///etc/passwd" }).expect(400);
    await request(app).post("/v1/audits").send({ ...body, script: "arbitrary code" }).expect(400);
    await request(app).get("/v1/audits").expect(404);
    expect(events).toEqual([]);
  });
});
