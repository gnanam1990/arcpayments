import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server";

/** Connect a fresh in-memory client to a fresh server instance. */
async function connectedClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

describe("metered-mcp server", () => {
  it("exposes exactly one free tool (echo) — no payment gating in Stage 1", async () => {
    const { server, client } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("echo");
    await client.close();
    await server.close();
  });

  it("responds to a call to the echo tool", async () => {
    const { server, client } = await connectedClient();
    const result = await client.callTool({ name: "echo", arguments: { text: "hello arc" } });
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("hello arc");
    await client.close();
    await server.close();
  });
});
