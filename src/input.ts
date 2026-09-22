import { z } from "zod";

export const auditInput = z.object({
  url: z.string().max(2048).url().refine((raw) => {
    const u = new URL(raw);
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password &&
      (!u.port || u.port === "80" || u.port === "443");
  }, "Only HTTP(S) URLs without credentials on ports 80/443 are supported"),
  viewports: z.array(z.enum(["desktop", "mobile"])).min(1).max(2)
    .refine((v) => new Set(v).size === v.length, "Duplicate viewport").default(["desktop", "mobile"]),
  checks: z.object({
    text: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    selectors: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  }).strict().default({ text: [], selectors: [] }),
}).strict();

export type AuditInput = z.infer<typeof auditInput>;
export type Check = { id: string; label: string; status: "pass" | "fail" | "unknown"; detail: string };
export type ViewportReport = {
  viewport: "desktop" | "mobile";
  width: number;
  height: number;
  finalUrl: string;
  httpStatus: number | null;
  checks: Check[];
  errors: string[];
  failedRequests: { url: string; reason: string }[];
  screenshot: { mimeType: "image/jpeg"; base64: string };
};
export type AuditReport = {
  id: string;
  url: string;
  createdAt: string;
  durationMs: number;
  outcome: "passed" | "issues_found" | "inconclusive";
  summary: { passed: number; failed: number; unknown: number };
  limitations: string[];
  viewports: ViewportReport[];
};
export type AuditResult = { report: AuditReport; html: string };
