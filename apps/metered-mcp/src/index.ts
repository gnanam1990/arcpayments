#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveSellerAddress } from "./identity";
import { SERVER_INFO, createServer } from "./server";

/**
 * metered-mcp entrypoint — run the server over stdio so any MCP client
 * (Claude Desktop, an agent, the MCP Inspector) can connect.
 *
 * Stage 2: one free `echo` tool, still no payments. The server now knows its
 * seller payout identity (env), held for Stage 3. Logs go to stderr so stdout
 * stays a clean JSON-RPC channel.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const seller = resolveSellerAddress();
  const identity = seller
    ? `payout identity ${seller}`
    : "no seller identity configured (set SELLER_ADDRESS or SELLER_PRIVATE_KEY)";
  process.stderr.write(
    `${SERVER_INFO.name} v${SERVER_INFO.version} running on stdio — ${identity}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `metered-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
