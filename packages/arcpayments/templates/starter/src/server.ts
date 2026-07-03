import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildPaymentRequirements,
  type ExactPaymentPayload,
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  LocalWallet,
  loadNetworkConfig,
  type PaymentRequirements,
  PaywallGuard,
  type ResourceInfo,
  type SettlementQueue,
  USDC_ERC20_DECIMALS,
} from "arcpayments";
import { type Address, getAddress, isAddress } from "viem";
import { z } from "zod";

/** Server identity advertised to MCP clients. */
export const SERVER_INFO = { name: "__APP_NAME__", version: "0.1.0" } as const;

/** The paid tool's name and price (change the price to your liking). */
export const PAID_TOOL_NAME = "premium_echo";
export const PAID_TOOL_PRICE = "$0.001";

/** The x402 `resource` this tool sells (Circle Gateway requires it on the payload). */
export const PAID_TOOL_RESOURCE: ResourceInfo = {
  url: `/${PAID_TOOL_NAME}`,
  description: "Premium echo — a paid metered tool",
  mimeType: "application/json",
};

/** Resolve the seller payout identity from env (SELLER_ADDRESS, else SELLER_PRIVATE_KEY). */
export function resolveSellerAddress(
  env: Record<string, string | undefined> = process.env,
): Address | undefined {
  const explicit = env.SELLER_ADDRESS?.trim();
  if (explicit) {
    if (!isAddress(explicit)) throw new Error(`SELLER_ADDRESS is not a valid address: "${explicit}"`);
    return getAddress(explicit);
  }
  const key = env.SELLER_PRIVATE_KEY?.trim();
  return key ? LocalWallet.fromPrivateKey(key as `0x${string}`).getAddress() : undefined;
}

export interface SellerPaywall {
  guard: PaywallGuard;
  queue: SettlementQueue;
  sellerAddress: Address;
}

/** Build the seller paywall from env. Returns undefined when no seller identity is set. */
export function buildSellerPaywall(
  env: Record<string, string | undefined> = process.env,
): SellerPaywall | undefined {
  const sellerAddress = resolveSellerAddress(env);
  if (!sellerAddress) return undefined;

  const net = loadNetworkConfig(env);
  const queue = new InMemorySettlementQueue();
  const guard = new PaywallGuard({
    requirements: buildPaymentRequirements({
      price: PAID_TOOL_PRICE,
      payTo: sellerAddress,
      caip2: net.caip2,
      asset: net.usdcAddress,
      verifyingContract: net.gatewayWallet,
      usdcDecimals: USDC_ERC20_DECIMALS,
      eip712: net.x402Domain,
      maxTimeoutSeconds: net.x402MinValiditySeconds,
    }),
    verifier: new LocalExactVerifier(new InMemoryNonceStore()),
    queue,
    resource: PAID_TOOL_RESOURCE,
  });
  return { guard, queue, sellerAddress };
}

function challenge(
  kind: "PAYMENT_REQUIRED" | "PAYMENT_INVALID",
  requirements: PaymentRequirements,
  resource: ResourceInfo | undefined,
  reason?: string,
) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          x402Version: 2,
          error: kind,
          ...(reason ? { reason } : {}),
          ...(resource ? { resource } : {}),
          accepts: [requirements],
        }),
      },
    ],
  };
}

export interface CreateServerOptions {
  paywall?: SellerPaywall;
}

/**
 * Build the metered MCP server: a free `echo` tool and an x402-gated `premium_echo`
 * (registered only when a seller identity is configured). Unpaid → challenge; valid
 * payment → run + queue for Circle Gateway batch settlement; invalid → refused.
 */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO);
  const paywall = "paywall" in options ? options.paywall : buildSellerPaywall();

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Return the text you send. A free, unmetered tool.",
      inputSchema: { text: z.string().describe("Text to echo back") },
    },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );

  if (paywall) {
    server.registerTool(
      PAID_TOOL_NAME,
      {
        title: "Premium Echo",
        description: `Uppercase echo, gated by an x402 payment of ${PAID_TOOL_PRICE} USDC. Send the signed x402 payment in \`payment\` (omit it to receive the challenge).`,
        inputSchema: {
          text: z.string().describe("Text to transform"),
          payment: z.unknown().optional().describe("x402 exact payment payload (from the challenge)"),
        },
      },
      async ({ text, payment }) => {
        const outcome = await paywall.guard.guard(
          payment as ExactPaymentPayload | undefined,
          async () => `PREMIUM: ${text.toUpperCase()}`,
        );
        if (outcome.status === "payment-required") {
          return challenge("PAYMENT_REQUIRED", outcome.requirements, outcome.resource);
        }
        if (outcome.status === "rejected") {
          return challenge("PAYMENT_INVALID", outcome.requirements, outcome.resource, outcome.reason);
        }
        return {
          content: [
            { type: "text", text: outcome.result },
            {
              type: "text",
              text: JSON.stringify({
                settlement: {
                  id: outcome.settlement.id,
                  status: outcome.settlement.status,
                  payer: outcome.settlement.payer,
                  amount: outcome.settlement.amount,
                },
              }),
            },
          ],
        };
      },
    );
  }

  return server;
}
