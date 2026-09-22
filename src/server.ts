import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { readConfig } from "./config.js";
import { createApp } from "./app.js";
import { createRunner } from "./audit/runner.js";
import { createPayment } from "./payment/middleware.js";

if (existsSync(".env")) loadEnvFile(".env");
const config = readConfig();
const app = createApp(config, { payment: createPayment(config), run: createRunner(config.AUDIT_TIMEOUT_MS) });
const server = app.listen(config.PORT, config.HOST, () => console.log(`Kite Web Check listening on ${config.HOST}:${config.PORT} (${config.KITE_NETWORK})`));
server.requestTimeout = 65000;
server.headersTimeout = 10000;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 45000).unref();
});
