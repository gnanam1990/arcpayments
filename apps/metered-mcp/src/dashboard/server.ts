import http from "node:http";
import type { AddressInfo } from "node:net";
import { renderDashboardPage } from "./page";
import type { SellerState } from "./state";

/**
 * Read-only dashboard HTTP server (Stage 7). Serves the page and exposes the real
 * seller state as JSON (`/api/state`) and a Server-Sent-Events stream
 * (`/api/stream`) that pushes fresh snapshots. It only ever READS `SellerState`;
 * there is no route that signs, moves funds, or accepts a key — the browser sees
 * public data + formatted balances, never a private key.
 */
export interface DashboardServerOptions {
  state: SellerState;
  /** SSE snapshot cadence (ms). Kept modest so the feed updates without strobing. */
  streamIntervalMs?: number;
}

export function createDashboardServer(options: DashboardServerOptions): http.Server {
  const page = renderDashboardPage();
  const interval = options.streamIntervalMs ?? 2000;

  return http.createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET" }).end();
      return;
    }

    if (url === "/" || url === "/index.html") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(page);
      return;
    }

    if (url === "/api/state") {
      try {
        const model = await options.state.model();
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(model));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "state error" }));
      }
      return;
    }

    if (url === "/api/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      let closed = false;
      const push = async () => {
        if (closed) return;
        try {
          const model = await options.state.model();
          res.write(`data: ${JSON.stringify(model)}\n\n`);
        } catch {
          /* transient — the next tick retries */
        }
      };
      await push();
      const timer = setInterval(push, interval);
      req.on("close", () => {
        closed = true;
        clearInterval(timer);
      });
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
}

/** Start the dashboard server; resolves with the server and the actual bound port. */
export function startDashboardServer(
  options: DashboardServerOptions & { port?: number; host?: string },
): Promise<{ server: http.Server; port: number }> {
  const server = createDashboardServer(options);
  return new Promise((resolve) => {
    server.listen(options.port ?? 4020, options.host ?? "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}
