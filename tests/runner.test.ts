import { it, expect } from "vitest";
import { createRunner } from "../src/audit/runner.js";
import { auditInput } from "../src/input.js";

const worker = new URL("./worker-fixture.mjs", import.meta.url);
it("returns a child-process result without forwarding gateway secrets", async () => {
  process.env.GATEWAY_TEST_SECRET = "synthetic-not-a-real-secret";
  try {
    const result = await createRunner(5000, worker)(auditInput.parse({ url: "https://example.com" }), new AbortController().signal);
    expect(result.report.id).toBe("worker-fixture");
    expect(result.html).toBe("environment filtered");
  } finally { delete process.env.GATEWAY_TEST_SECRET; }
});
it("rejects a crashed worker", async () => {
  await expect(createRunner(5000, worker)(auditInput.parse({ url: "https://example.com/crash" }), new AbortController().signal)).rejects.toThrow("WORKER_EXITED");
});
it("cancels an in-flight worker", async () => {
  const controller = new AbortController();
  const promise = createRunner(5000, worker)(auditInput.parse({ url: "https://example.com/wait" }), controller.signal);
  const assertion = expect(promise).rejects.toThrow("AUDIT_ABORTED");
  controller.abort();
  await assertion;
});
