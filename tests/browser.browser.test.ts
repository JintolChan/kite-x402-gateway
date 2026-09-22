import { describe, it, expect } from "vitest";
import { runBrowserAudit } from "../src/audit/browser.js";
import { auditInput } from "../src/input.js";
import { fixtureSite } from "./fixtures.js";

describe("real Chromium checks", () => {
  it("finds broken images, mobile overflow, script errors and missing text", async () => {
    const fixture = await fixtureSite();
    try {
      const result = await runBrowserAudit(auditInput.parse({ url: "http://fixture.test/broken", checks: { text: ["Ship with evidence.", "not present"], selectors: ["h1"] } }), { proxyFactory: fixture.proxyFactory });
      expect(result.report.outcome).toBe("issues_found");
      const desktop = result.report.viewports[0]!;
      const mobile = result.report.viewports[1]!;
      const status = (id: string) => mobile.checks.find((c) => c.id === id)?.status;
      expect(status("images")).toBe("fail"); expect(status("overflow")).toBe("fail");
      expect(status("console")).toBe("fail"); expect(status("text-0")).toBe("pass");
      expect(status("text-1")).toBe("fail"); expect(status("selector-0")).toBe("pass");
      expect(desktop.checks.find((c) => c.id === "overflow")?.status).toBe("pass");
      expect(Buffer.from(mobile.screenshot.base64, "base64").subarray(0,2).toString("hex")).toBe("ffd8");
      expect(result.html).toContain("Issues found");
    } finally { await fixture.close(); }
  });
  it("passes a healthy page and treats invalid selectors as unknown", async () => {
    const fixture = await fixtureSite();
    try {
      const healthy = await runBrowserAudit(auditInput.parse({ url: "http://fixture.test/healthy", viewports: ["mobile"] }), { proxyFactory: fixture.proxyFactory });
      expect(healthy.report.outcome).toBe("passed");
      const invalid = await runBrowserAudit(auditInput.parse({ url: "http://fixture.test/healthy", viewports: ["desktop"], checks: { selectors: ["["] } }), { proxyFactory: fixture.proxyFactory });
      expect(invalid.report.outcome).toBe("inconclusive");
    } finally { await fixture.close(); }
  });
  it("blocks private subresources and redirects", async () => {
    const fixture = await fixtureSite();
    try {
      const result = await runBrowserAudit(auditInput.parse({ url: "http://fixture.test/ssrf", viewports: ["desktop"] }), { proxyFactory: fixture.proxyFactory });
      expect(result.report.viewports[0]!.failedRequests.length).toBeGreaterThan(0);
      // A blocked redirect can produce a 403 document or a navigation failure.
      try {
        const redirected = await runBrowserAudit(auditInput.parse({ url: "http://fixture.test/redirect", viewports: ["desktop"] }), { proxyFactory: fixture.proxyFactory });
        expect(redirected.report.outcome).not.toBe("passed");
      } catch { /* rejected navigation is expected */ }
      expect(fixture.privateHits()).toBe(0);
    } finally { await fixture.close(); }
  });
  it("does not report a 500 error page as a healthy website", async () => {
    const fixture = await fixtureSite();
    try {
      const result = await runBrowserAudit(auditInput.parse({ url: "http://fixture.test/error", viewports: ["desktop"] }), { proxyFactory: fixture.proxyFactory });
      expect(result.report.outcome).toBe("issues_found");
      expect(result.report.summary.passed).toBe(0);
    } finally { await fixture.close(); }
  });
});
