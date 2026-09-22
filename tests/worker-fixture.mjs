// Test-only IPC worker, never imported by the production entry point.
process.once('message', ({ input }) => {
  if (input.url.endsWith('/wait')) return setInterval(() => {}, 1000);
  if (input.url.endsWith('/crash')) return process.exit(2);
  process.send({ ok: true, result: {
    report: { id: 'worker-fixture', url: input.url, createdAt: 'fixture', durationMs: 1, outcome: 'passed', summary: { passed: 1, failed: 0, unknown: 0 }, viewports: [], limitations: [] },
    html: process.env.GATEWAY_TEST_SECRET ? 'secret leaked' : 'environment filtered'
  } });
});
