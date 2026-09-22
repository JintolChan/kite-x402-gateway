import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { resolvePublicTarget } from "./target.js";

type TargetResolver = typeof resolvePublicTarget;
const hopHeaders = new Set(["connection", "proxy-connection", "proxy-authorization", "proxy-authenticate", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer"]);

/** All browser traffic passes through here. DNS is resolved, checked and pinned
 * to the connection IP, eliminating the check-then-resolve-again rebinding gap. */
export async function startProxy(resolveTarget: TargetResolver = resolvePublicTarget) {
  const sockets = new Set<Duplex>();
  let bytes = 0;
  let requests = 0;
  let closed = false;
  const track = (socket: Duplex) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 40 * 1024 * 1024) for (const s of sockets) s.destroy();
    });
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (++requests > 400 || !["GET", "HEAD"].includes(req.method ?? "")) throw new Error("Request limit");
      const target = await resolveTarget(req.url ?? "");
      if (closed || target.url.protocol !== "http:") throw new Error("Invalid proxy request");
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !hopHeaders.has(k)));
      headers.host = target.url.host;
      const outgoing = http.request({
        host: target.address, family: target.family, port: Number(target.url.port || 80),
        path: target.url.pathname + target.url.search, method: req.method, headers, timeout: 10000,
      }, (upstream) => {
        const responseHeaders = Object.fromEntries(Object.entries(upstream.headers).filter(([k]) => !hopHeaders.has(k)));
        res.writeHead(upstream.statusCode ?? 502, responseHeaders);
        upstream.pipe(res);
      });
      outgoing.on("socket", track);
      outgoing.on("timeout", () => outgoing.destroy());
      outgoing.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on("close", () => outgoing.destroy());
      outgoing.end();
    } catch { res.writeHead(403); res.end("Target blocked by network policy"); }
  });
  server.on("connection", (s) => { track(s); s.setTimeout(15000, () => s.destroy()); });
  server.on("connect", async (req, client, head) => {
    try {
      if (++requests > 400) throw new Error("Request limit");
      const target = await resolveTarget(`https://${req.url}`);
      if (closed || target.url.pathname !== "/" || target.url.search || target.url.hash) throw new Error("Invalid tunnel");
      const remote = net.connect({ host: target.address, family: target.family, port: Number(target.url.port || 443) });
      track(remote);
      remote.setTimeout(15000, () => remote.destroy());
      client.on("close", () => remote.destroy());
      remote.on("error", () => client.destroy());
      remote.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) remote.write(head);
        client.pipe(remote).pipe(client);
      });
    } catch { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); }
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.on("clientError", (_err, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
