#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_INFO, createServer, resolveSellerAddress } from "./server.js";

/**
 * __APP_NAME__ — a metered MCP server on Arc testnet.
 *
 * Runs over stdio so any MCP client (Claude Desktop, an agent, the MCP Inspector)
 * can connect. Logs go to stderr so stdout stays a clean JSON-RPC channel.
 *
 * Setup: `npx arcpayments wallet:new` then `npx arcpayments faucet`, fill `.env`,
 * then `npm start`. Check your setup any time with `npm run doctor`.
 */
async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());

  const seller = resolveSellerAddress();
  const identity = seller
    ? `payout identity ${seller}`
    : "no seller identity (run `npx arcpayments wallet:new`, then set SELLER_ADDRESS or SELLER_PRIVATE_KEY)";
  process.stderr.write(`${SERVER_INFO.name} v${SERVER_INFO.version} on stdio — ${identity}\n`);
}

main().catch((err) => {
  process.stderr.write(`__APP_NAME__ failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
