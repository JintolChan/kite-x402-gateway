import { describe, it, expect } from "vitest";
import http from "node:http";
import net from "node:net";
import { isPublicAddress, resolvePublicTarget, parseTarget } from "../src/security/target.js";
import { startProxy } from "../src/security/proxy.js";

describe("public target policy", () => {
  it.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"])("blocks reserved address %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["https://localhost", "http://2130706433", "http://0x7f000001", "http://[::ffff:127.0.0.1]", "file:///etc/passwd", "http://user:pass@example.com", "http://example.com:8080"])("rejects target %s", async (url) => await expect(resolvePublicTarget(url)).rejects.toThrow());
  it("rejects mixed public/private DNS answers", async () => {
    await expect(resolvePublicTarget("https://example.com", async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }])).rejects.toThrow();
  });
  it("pins a validated DNS address", async () => {
    const target = await resolvePublicTarget("https://example.com", async () => [{ address: "93.184.216.34", family: 4 }]);
    expect(target.address).toBe("93.184.216.34");
    expect(parseTarget("https://example.com/path").hostname).toBe("example.com");
  });
  it("rejects private HTTP requests and CONNECT tunnels at socket boundary", async () => {
    const proxy = await startProxy();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(proxy.url, { path: "http://169.254.169.254/latest/meta-data/" }, (res) => { res.resume(); resolve(res.statusCode!); });
        req.on("error", reject); req.end();
      });
      expect(status).toBe(403);
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(Number(new URL(proxy.url).port), "127.0.0.1", () => socket.write("CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"));
        socket.on("data", (data) => { resolve(data.toString()); socket.destroy(); }); socket.on("error", reject);
      });
      expect(response).toContain("403 Forbidden");
    } finally { await proxy.close(); }
  });
  it("forwards CONNECT bytes to the checked address", async () => {
    const echo = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
    const port = (echo.address() as net.AddressInfo).port;
    const proxy = await startProxy(async (raw) => {
      const url = new URL(raw);
      if (url.hostname !== "fixture.test") throw new Error("Unexpected host");
      url.port = String(port);
      return { url, address: "127.0.0.1", family: 4 };
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let connected = false;
        const socket = net.connect(Number(new URL(proxy.url).port), "127.0.0.1", () => socket.write("CONNECT fixture.test:443 HTTP/1.1\r\nHost: fixture.test\r\n\r\n"));
        socket.on("error", reject);
        socket.on("data", (data) => {
          try {
            if (!connected) { expect(data.toString()).toContain("200 Connection Established"); connected = true; socket.write("tunnel-test"); }
            else { expect(data.toString()).toBe("tunnel-test"); socket.destroy(); resolve(); }
          } catch (error) { socket.destroy(); reject(error); }
        });
      });
    } finally { await proxy.close(); await new Promise<void>((resolve) => echo.close(() => resolve())); }
  });
});
