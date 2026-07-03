#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemorySettlementQueue, type SettlementQueue } from "arcpayments";
import { SERVER_INFO, buildSellerPaywall, createServer } from "../server";
import { startDashboardServer } from "./server";
import { buildSellerState } from "./wire";

/**
 * Run metered-mcp AND its seller dashboard in ONE process, over a SHARED settlement
 * queue — so real paid `premium_echo` calls (via the stdio MCP channel) stream into
 * the dashboard's live feed. The dashboard is read-only HTTP; the MCP JSON-RPC stays
 * on stdout, logs on stderr. No key is ever exposed to the browser.
 *
 *   SELLER_PRIVATE_KEY=0x… DASHBOARD_PORT=4020 bun run --filter metered-mcp dashboard
 */
async function main(): Promise<void> {
  // Build the paywall ONCE so the MCP tool and the dashboard share the same queue.
  const paywall = buildSellerPaywall();
  const server = createServer(paywall ? { paywall } : {});
  await server.connect(new StdioServerTransport());

  const queue: SettlementQueue = paywall?.queue ?? new InMemorySettlementQueue();
  const { state } = buildSellerState({ env: process.env, queue });

  const port = Number(process.env.DASHBOARD_PORT ?? "4020");
  await startDashboardServer({ state, port });

  process.stderr.write(
    `${SERVER_INFO.name} v${SERVER_INFO.version} — MCP on stdio · dashboard on http://127.0.0.1:${port}\n`,
  );
  if (!paywall) {
    process.stderr.write(
      "note: no seller identity set — dashboard shows honest empty states. Set SELLER_ADDRESS or SELLER_PRIVATE_KEY.\n",
    );
  }
}

main().catch((err) => {
  process.stderr.write(
    `metered-mcp dashboard failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
