import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine((s) => !/^0x0{40}$/.test(s), "PAY_TO cannot be the zero address"),
  KITE_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  PRICE_USD: z.string().regex(/^(0|[1-9]\d{0,3})(\.\d{1,6})?$/).refine((s) => Number(s) > 0).default("0.01"),
  FACILITATOR_URL: z.string().url().default("https://facilitator.pieverse.io/v2"),
  AUDIT_TIMEOUT_MS: z.coerce.number().int().min(5000).max(40000).default(30000),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(env = process.env): Config {
  const config = envSchema.parse(env);
  const facilitator = new URL(config.FACILITATOR_URL);
  if (facilitator.protocol !== "https:" || facilitator.username || facilitator.password) {
    throw new Error("FACILITATOR_URL must use HTTPS without URL credentials");
  }
  return config;
}
