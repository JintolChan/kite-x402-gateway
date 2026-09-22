import http from "node:http";
import type { AddressInfo } from "node:net";
import { startProxy } from "../src/security/proxy.js";
import { resolvePublicTarget } from "../src/security/target.js";

export async function fixtureSite() {
  let privateHits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/private") { privateHits++; res.end("should never reach this"); return; }
    if (req.url === "/redirect") { res.writeHead(302, { location: "http://127.0.0.1/private" }); res.end(); return; }
    if (req.url === "/missing.png") { res.writeHead(404); res.end(); return; }
    const broken = req.url === "/broken";
    const blocked = req.url === "/ssrf";
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/error") res.statusCode = 500;
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      *{box-sizing:border-box}body{margin:0;background:#edf4f0;font-family:system-ui;color:#163b31}main{max-width:1000px;margin:60px auto;padding:36px;background:white;border-radius:20px}h1{font-size:42px}p{line-height:1.7}.tag{color:#23785a;font-size:12px;letter-spacing:2px}.card{background:#e2eee7;padding:28px;border-radius:12px;margin-top:28px;${broken ? "width:850px;" : "max-width:100%;"}}@media(max-width:600px){main{margin:20px;padding:24px}h1{font-size:32px}}
    </style></head><body><main><div class="tag">KITE WEB CHECK · CONTROLLED FIXTURE</div><h1>Ship with evidence.</h1><p>A repeatable acceptance check for your next website release.</p><div class="card"><h2>Latest release</h2><p>${broken ? "This fixture intentionally contains mobile overflow, an unavailable image and a script error." : "This fixture is responsive and has no intentional browser errors."}</p>${broken ? '<img src="/missing.png" alt="Missing product image"><script>console.error("Fixture: checkout widget failed");</script>' : ""}${blocked ? '<img src="http://127.0.0.1/private"><script>fetch("http://169.254.169.254/latest/meta-data/").catch(()=>{});</script>' : ""}</div></main></body></html>`);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const { port } = server.address() as AddressInfo;
  // Only this test helper maps a fictional hostname to a fixed local fixture.
  // Production worker never imports it and has no environment bypass switch.
  const proxyFactory = () => startProxy(async (raw) => {
    const url = new URL(raw);
    if (url.hostname !== "fixture.test" || url.port || url.protocol !== "http:") return resolvePublicTarget(raw);
    url.port = String(port);
    return { url, address: "127.0.0.1", family: 4 };
  });
  return { proxyFactory, privateHits: () => privateHits, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
