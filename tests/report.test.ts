import { it, expect } from "vitest";
import { renderReport } from "../src/report.js";
import { readConfig } from "../src/config.js";
import { auditInput } from "../src/input.js";
import { KITE_MAINNET, KITE_TESTNET, kiteMoneyParser } from "../src/payment/kite.js";

it("escapes website content in standalone reports", () => {
  const html = renderReport({ id: "id", url: "https://example.com/<script>alert(1)</script>", createdAt: "now", durationMs: 1,
    outcome: "inconclusive", summary: { passed: 0, failed: 0, unknown: 1 }, viewports: [], limitations: ['<img src=x onerror="alert(1)">'] });
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("Content-Security-Policy");
});
it("requires an actual receiving address and rejects unsafe configuration", () => {
  expect(() => readConfig({ PAY_TO: `0x${"0".repeat(40)}` })).toThrow();
  expect(() => readConfig({ PAY_TO: `0x${"1".repeat(40)}`, PRICE_USD: "0" })).toThrow();
  expect(() => readConfig({ PAY_TO: `0x${"1".repeat(40)}`, FACILITATOR_URL: "http://localhost" })).toThrow();
});
it("bounds checks and rejects arbitrary fields", () => {
  expect(auditInput.safeParse({ url: "https://example.com", viewports: ["mobile", "mobile"] }).success).toBe(false);
  expect(auditInput.safeParse({ url: "https://example.com", checks: { text: Array(11).fill("a") } }).success).toBe(false);
});
it("uses the correct token decimals on both Kite networks", async () => {
  expect(await kiteMoneyParser(KITE_MAINNET)("0.01", "eip155:2366")).toMatchObject({ amount: "10000", extra: { name: "Bridged USDC (Kite AI)", version: "2" } });
  expect(await kiteMoneyParser(KITE_TESTNET)("0.01", "eip155:2368")).toMatchObject({ amount: "10000000000000000", extra: { name: "pieUSD", version: "1" } });
});
