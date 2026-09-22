import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { Config } from "../config.js";
import { kiteChainByName, kiteMoneyParser } from "./kite.js";

export function createPayment(config: Config, facilitator?: FacilitatorClient) {
  const chain = kiteChainByName(config.KITE_NETWORK);
  const resource = new x402ResourceServer(facilitator ?? new HTTPFacilitatorClient({ url: config.FACILITATOR_URL, timeoutMs: 10000 }))
    .register(chain.network, new ExactEvmScheme().registerMoneyParser(kiteMoneyParser(chain)));
  return paymentMiddleware({
    "POST /v1/audits": {
      accepts: { scheme: "exact", price: `$${config.PRICE_USD}`, network: chain.network, payTo: config.PAY_TO, maxTimeoutSeconds: 120 },
      description: "Run website acceptance checks. A completed defect report is billable; execution failure is not. JSON includes screenshots and an HTML report.",
      mimeType: "application/json",
    },
  }, resource);
}
