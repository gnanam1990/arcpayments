import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ARC_TESTNET_DEFAULTS,
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  LocalWallet,
  PaywallGuard,
  USDC_ERC20_DECIMALS,
  buildPaymentRequirements,
  payForCall,
  startPaymentLoop,
} from "arcpayments";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { mcpPaidToolTransport } from "../src/buyer";
import { PAID_TOOL_NAME, type SellerPaywall, createServer } from "../src/server";

const buyer = LocalWallet.fromPrivateKey(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
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
      maxTimeoutSeconds: net.x402MinValiditySeconds,
    }),
    verifier: new LocalExactVerifier(new InMemoryNonceStore()),
    queue,
  });
  return { guard, queue, sellerAddress: seller.getAddress() };
}

async function connect(paywall: SellerPaywall) {
  const server = createServer({ paywall });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "buyer", version: "0.0.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { server, client };
}

let nonceSeq = 0;
const nextNonce = (): Hex => `0x${(++nonceSeq).toString(16).padStart(64, "0")}` as Hex;

describe("metered-mcp buyer agent (over the MCP transport)", () => {
  it("completes challenge → sign → retry → result for the paid tool", async () => {
    const paywall = makePaywall();
    const { server, client } = await connect(paywall);
    const transport = mcpPaidToolTransport(client, PAID_TOOL_NAME, { text: "hello" });

    const result = await payForCall({ transport, wallet: buyer, nonce: nextNonce });
    expect(result.paid).toBe(true);
    expect(String(result.content)).toContain("HELLO");
    expect(paywall.queue.pending()).toHaveLength(1);
    expect(paywall.queue.pending()[0]?.payer).toBe(buyer.getAddress());

    await client.close();
    await server.close();
  });

  it("loops N paid calls under the hard caps over the MCP transport", async () => {
    const paywall = makePaywall();
    const { server, client } = await connect(paywall);
    const transport = mcpPaidToolTransport(client, PAID_TOOL_NAME, { text: "hi" });

    const loop = await startPaymentLoop({
      transport,
      wallet: buyer,
      nonce: nextNonce,
      maxCalls: 3,
      maxTotalSpend: 1_000_000n,
    });
    expect(loop.calls).toBe(3);
    expect(loop.stoppedBy).toBe("maxCalls");
    expect(paywall.queue.pending()).toHaveLength(3);

    await client.close();
    await server.close();
  });
});
