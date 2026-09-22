import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats.default(ajv);
const schema = JSON.parse(await readFile("schema/service.schema.json", "utf8"));
const manifest = parse(await readFile("service.yaml", "utf8"));
const validate = ajv.compile<{ status: string; maintainer: { github: string }; pay_to: string; upstream: { url: string }; base_url?: string }>(schema);
if (!validate(manifest)) {
  console.error(JSON.stringify(validate.errors, null, 2)); process.exitCode = 1;
} else if (process.argv.includes("--release") && (
  manifest.status === "draft" || manifest.maintainer.github === "replace-me" || /^0x0{40}$/.test(manifest.pay_to) ||
  manifest.upstream.url.includes("example.invalid") || !manifest.base_url
)) {
  console.error("Release validation failed: deployment details and real-payment evidence are still required."); process.exitCode = 1;
} else {
  console.log(`Manifest schema valid (${manifest.status}).${manifest.status === "draft" ? " Placeholder values remain; not ready for submission." : " Verify actual deployment and paid-call evidence separately."}`);
}
