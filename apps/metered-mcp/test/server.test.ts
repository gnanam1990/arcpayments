import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ARC_TESTNET_DEFAULTS,
  type ExactPaymentPayload,
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  LocalWallet,
  PaywallGuard,
  USDC_ERC20_DECIMALS,
  buildPaymentRequirements,
  signExactPayment,
} from "arcpayments";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { PAID_TOOL_NAME, type SellerPaywall, createServer } from "../src/server";

const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const buyer = LocalWallet.fromPrivateKey(BUYER_KEY);
const seller = LocalWallet.fromPrivateKey(
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
);

function makePaywall(): SellerPaywall {
  const net = ARC_TESTNET_DEFAULTS;
  const queue = new InMemorySettlementQueue();
  const guard = new PaywallGuard({
    requirements: buildPaymentRequirements({
      price: "$0.001",
      payTo: seller.getAddress(),
      caip2: net.caip2,
      asset: net.usdcAddress,
      verifyingContract: net.gatewayWallet,
      usdcDecimals: USDC_ERC20_DECIMALS,
      eip712: net.x402Domain,
    }),
    verifier: new LocalExactVerifier(new InMemoryNonceStore()),
    queue,
    resource: { url: "/premium_echo", description: "paid", mimeType: "application/json" },
  });
  return { guard, queue, sellerAddress: seller.getAddress() };
}

async function connected(options?: { paywall?: SellerPaywall }) {
  const server = createServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

let nonceSeq = 0;
function nextNonce(): Hex {
  nonceSeq += 1;
  return `0x${nonceSeq.toString(16).padStart(64, "0")}` as Hex;
}

async function sign(paywall: SellerPaywall): Promise<ExactPaymentPayload> {
  return signExactPayment(buyer.getAccount(), paywall.guard.requirements, { nonce: nextNonce() });
}

describe("metered-mcp — free echo tool", () => {
  it("exposes echo (free) and answers a call, with no paywall configured", async () => {
    const { server, client } = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("echo");
    expect(tools.map((t) => t.name)).not.toContain(PAID_TOOL_NAME);
    const result = await client.callTool({ name: "echo", arguments: { text: "hello arc" } });
    expect(textOf(result)).toContain("hello arc");
    await client.close();
    await server.close();
  });
});

describe("metered-mcp — paid tool (x402 paywall)", () => {
  it("lists the paid tool alongside the free echo when a paywall is configured", async () => {
    const { server, client } = await connected({ paywall: makePaywall() });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("echo");
    expect(names).toContain(PAID_TOOL_NAME);
    await client.close();
    await server.close();
  });

  it("returns the payment challenge (not the result) when called unpaid", async () => {
    const { server, client } = await connected({ paywall: makePaywall() });
    const result = await client.callTool({ name: PAID_TOOL_NAME, arguments: { text: "secret" } });
    expect(result.isError).toBe(true);
    const envelope = JSON.parse(textOf(result));
    expect(envelope.error).toBe("PAYMENT_REQUIRED");
    expect(envelope.accepts[0].amount).toBe("1000");
    // Gateway-required: the challenge carries the resource being paid for.
    expect(envelope.resource).toEqual({
      url: "/premium_echo",
      description: "paid",
      mimeType: "application/json",
    });
    expect(textOf(result)).not.toContain("SECRET");
    await client.close();
    await server.close();
  });

  it("runs the tool and enqueues a settlement on a valid payment", async () => {
    const paywall = makePaywall();
    const { server, client } = await connected({ paywall });
    const payment = await sign(paywall);
    const result = await client.callTool({
      name: PAID_TOOL_NAME,
      arguments: { text: "secret", payment },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("SECRET");
    expect(paywall.queue.pending()).toHaveLength(1);
    await client.close();
    await server.close();
  });

  it("rejects an invalid payment and does not run the tool or enqueue", async () => {
    const paywall = makePaywall();
    const { server, client } = await connected({ paywall });
    const payment = await sign(paywall);
    payment.payload.authorization.value = "1"; // below price → verify fails
    const result = await client.callTool({
      name: PAID_TOOL_NAME,
      arguments: { text: "secret", payment },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result)).error).toBe("PAYMENT_INVALID");
    expect(paywall.queue.pending()).toHaveLength(0);
    await client.close();
    await server.close();
  });
});
