import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Server identity advertised to MCP clients. */
export const SERVER_INFO = {
  name: "metered-mcp",
  version: "0.1.0",
} as const;

/**
 * Build the metered-mcp server.
 *
 * Stage 1: a bare server exposing exactly one **free** tool (`echo`) — no payment
 * gating yet. The x402 paywall wraps this same tool in Stage 3; keeping it as a
 * factory lets tests connect over an in-memory transport without spawning a process.
 */
export function createServer(): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Return the text you send. A free, unmetered tool (Stage 1 has no payments).",
      inputSchema: { text: z.string().describe("Text to echo back") },
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
    }),
  );

  return server;
}
