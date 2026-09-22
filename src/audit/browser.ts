import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type { AuditInput, AuditResult, Check, ViewportReport } from "../input.js";
import { renderReport } from "../report.js";
import { parseTarget } from "../security/target.js";
import { startProxy } from "../security/proxy.js";

const sizes = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
function safeUrl(raw: string) {
  try { const u = new URL(raw); u.search = ""; u.hash = ""; u.username = ""; u.password = ""; return u.toString().slice(0,500); }
  catch { return "[invalid URL]"; }
}

export async function runBrowserAudit(input: AuditInput, options: {
  timeoutMs?: number;
  proxyFactory?: typeof startProxy;
} = {}): Promise<AuditResult> {
  const started = Date.now();
  const proxy = await (options.proxyFactory ?? startProxy)();
  let browser: Browser | undefined;
  const timeoutMs = options.timeoutMs ?? 30000;
  const deadline = setTimeout(() => { void browser?.close(); void proxy.close(); }, timeoutMs);
  const viewports: ViewportReport[] = [];
  try {
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: process.platform === "linux",
      proxy: { server: proxy.url, bypass: "<-loopback>" },
      args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-background-networking"],
    });
    for (const viewport of input.viewports) {
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining < 1000) throw new Error("AUDIT_TIMEOUT");
      const context = await browser.newContext({
        viewport: sizes[viewport], deviceScaleFactor: 1, serviceWorkers: "block",
        acceptDownloads: false, ignoreHTTPSErrors: false,
        isMobile: viewport === "mobile", hasTouch: viewport === "mobile",
      });
      try { viewports.push(await inspect(context, input, viewport, Math.min(10000, remaining))); }
      finally { await context.close(); }
    }
    const checks = viewports.flatMap((v) => v.checks);
    const summary = {
      passed: checks.filter((c) => c.status === "pass").length,
      failed: checks.filter((c) => c.status === "fail").length,
      unknown: checks.filter((c) => c.status === "unknown").length,
    };
    const report: AuditResult["report"] = {
      id: randomUUID(), url: safeUrl(input.url), createdAt: new Date().toISOString(), durationMs: Date.now() - started,
      outcome: summary.failed ? "issues_found" : summary.unknown ? "inconclusive" : "passed",
      summary, viewports,
      limitations: [
        "Only the supplied page is checked; there is no link crawling, login or form submission.",
        "Mobile is a Chromium viewport simulation, not a physical device test.",
        "Observations are captured shortly after DOMContentLoaded. Late content and offscreen lazy images may not be observed.",
        "Non-GET/HEAD requests, WebSockets, service workers and private-network resources are blocked; this can affect page behavior.",
        "Console messages and screenshots may contain page data. Reports are returned inline and are not stored by the server.",
        "Detected website defects are a successful test delivery and are billable. Execution failures return an error without requesting settlement.",
      ],
    };
    return { report, html: renderReport(report) };
  } finally {
    clearTimeout(deadline);
    await browser?.close().catch(() => {});
    await proxy.close();
  }
}

async function inspect(context: BrowserContext, input: AuditInput, viewport: "desktop" | "mobile", navigationTimeout: number): Promise<ViewportReport> {
  let requestCount = 0;
  const failedRequests: ViewportReport["failedRequests"] = [];
  const failure = (url: string, reason: string) => {
    if (failedRequests.length < 50) failedRequests.push({ url: safeUrl(url), reason: reason.slice(0,200) });
  };
  await context.route("**/*", async (route) => {
    try {
      parseTarget(route.request().url());
      if (++requestCount > 200 || !["GET", "HEAD"].includes(route.request().method())) throw new Error("Blocked request");
      await route.continue();
    } catch { failure(route.request().url(), "Blocked by execution policy"); await route.abort().catch(() => {}); }
  });
  await context.routeWebSocket("**/*", (socket) => { failure(socket.url(), "WebSockets disabled"); socket.close(); });
  const page = await context.newPage();
  page.on("popup", (popup) => void popup.close());
  page.on("dialog", (dialog) => void dialog.dismiss());
  page.setDefaultTimeout(1500);
  const errors: string[] = [];
  const recordError = (s: string) => { if (errors.length < 30) errors.push(s.slice(0,500)); };
  page.on("pageerror", (err) => recordError(err.message));
  page.on("console", (message) => { if (message.type() === "error") recordError(message.text()); });
  page.on("requestfailed", (req) => failure(req.url(), req.failure()?.errorText ?? "Request failed"));
  page.on("response", (res) => { if (res.status() >= 400) failure(res.url(), `HTTP ${res.status()}`); });

  // A navigation failure has no useful loaded-page report and is not billable.
  const response = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
  if (!response) throw new Error("NO_NAVIGATION_RESPONSE");
  await page.waitForTimeout(500);
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, status: ok ? "pass" : "fail", detail });
  add("http", "Page responds successfully", response.status() >= 200 && response.status() < 400, `Final HTTP status: ${response.status()}`);
  const loaded = response.status() >= 200 && response.status() < 400;
  const dom = await page.evaluate(() => {
    const root = document.documentElement;
    const images = Array.from(document.images);
    return {
      // Mobile Chromium can expand innerWidth to include overflowing content.
      // clientWidth retains the layout viewport's intended width.
      overflow: Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) - root.clientWidth,
      brokenImages: images.filter((img) => img.complete && img.naturalWidth === 0 && Boolean(img.currentSrc || img.getAttribute("src"))).map((img) => img.currentSrc || img.src).slice(0,30),
      pendingImages: images.filter((img) => !img.complete).length,
      imageCount: images.length,
    };
  });
  add("overflow", "No horizontal overflow", dom.overflow <= 1, `${Math.max(0, dom.overflow)}px beyond viewport width`);
  checks.push({ id: "images", label: "Images load", status: dom.brokenImages.length ? "fail" : dom.pendingImages ? "unknown" : "pass",
    detail: `${dom.imageCount} images; ${dom.brokenImages.length} broken; ${dom.pendingImages} pending. ${dom.brokenImages.map(safeUrl).join(", ")}` });
  for (const [index, text] of input.checks.text.entries()) {
    const visible = await page.getByText(text, { exact: false }).first().isVisible();
    add(`text-${index}`, `Visible text: ${text}`, visible, visible ? "Matching visible text found" : "No matching visible text found");
  }
  for (const [index, selector] of input.checks.selectors.entries()) {
    try {
      const count = await page.locator(`css=${selector}`).count();
      const visible = count > 0 && await page.locator(`css=${selector}`).first().isVisible();
      add(`selector-${index}`, `Visible element: ${selector}`, visible, `${count} matches; first match ${visible ? "visible" : "not visible"}`);
    } catch { checks.push({ id: `selector-${index}`, label: `Visible element: ${selector}`, status: "unknown", detail: "Selector could not be evaluated; use a valid CSS selector" }); }
  }
  const screenshot = await page.screenshot({ type: "jpeg", quality: 65, fullPage: false, timeout: 4000, animations: "disabled" });
  add("console", "No browser errors", errors.length === 0, `${errors.length} captured console or script errors (maximum 30)`);
  add("requests", "No failed network requests", failedRequests.length === 0, `${failedRequests.length} failed or blocked requests (maximum 50)`);
  if (!loaded) for (const check of checks) {
    if (check.id !== "http") { check.status = "unknown"; check.detail = "The page returned an HTTP error; its error document does not establish the requested page's behavior."; }
  }
  return { viewport, ...sizes[viewport], finalUrl: safeUrl(page.url()), httpStatus: response.status(), checks, errors, failedRequests,
    screenshot: { mimeType: "image/jpeg", base64: screenshot.toString("base64") } };
}
