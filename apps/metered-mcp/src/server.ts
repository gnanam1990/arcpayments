import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type ExactPaymentPayload,
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  type PaymentRequirements,
  PaywallGuard,
  type SettlementQueue,
  USDC_ERC20_DECIMALS,
  buildPaymentRequirements,
  loadNetworkConfig,
} from "arcpayments";
import type { Address } from "viem";
import { z } from "zod";
import { resolveSellerAddress } from "./identity";

/** Server identity advertised to MCP clients. */
export const SERVER_INFO = {
  name: "metered-mcp",
  version: "0.3.0",
} as const;

/** The paid tool's name and price (not a magic number inline). */
export const PAID_TOOL_NAME = "premium_echo";
export const PAID_TOOL_PRICE = "$0.001";

/** Everything the server needs to gate + settle the paid tool. */
export interface SellerPaywall {
  guard: PaywallGuard;
  queue: SettlementQueue;
  sellerAddress: Address;
}

/**
 * Build the seller paywall from env: seller identity via the arcpayments `Wallet`
 * seam, endpoints/decimals from the network module. Returns `undefined` when no
 * seller identity is configured (the server then runs echo-only).
 */
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
      usdcDecimals: USDC_ERC20_DECIMALS,
      eip712: net.usdcEip712,
    }),
    verifier: new LocalExactVerifier(new InMemoryNonceStore()),
    queue,
  });
  return { guard, queue, sellerAddress };
}

/** Options for {@link createServer}. */
export interface CreateServerOptions {
  /** Inject a paywall (tests / explicit wiring); defaults to {@link buildSellerPaywall}. */
  paywall?: SellerPaywall;
}

/** In-band x402 challenge envelope (documented in ADR-0001; maps to an HTTP 402 body). */
function challenge(
  kind: "PAYMENT_REQUIRED" | "PAYMENT_INVALID",
  requirements: PaymentRequirements,
  reason?: string,
) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          x402Version: 1,
          error: kind,
          ...(reason ? { reason } : {}),
          accepts: [requirements],
        }),
      },
    ],
  };
}

/**
 * Build the metered-mcp server.
 *
 * - `echo` — a free, unmetered tool (kept for contrast/testing).
 * - `premium_echo` — gated by the x402 paywall (registered only when a seller
 *   paywall is configured). Unpaid → challenge; valid payment → run + queue for
 *   batch settlement; invalid → refused without running.
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
          payment: z
            .unknown()
            .optional()
            .describe("x402 exact payment payload (from the challenge)"),
        },
      },
      async ({ text, payment }) => {
        const outcome = await paywall.guard.guard(
          payment as ExactPaymentPayload | undefined,
          async () => `PREMIUM: ${text.toUpperCase()}`,
        );
        if (outcome.status === "payment-required") {
          return challenge("PAYMENT_REQUIRED", outcome.requirements);
        }
        if (outcome.status === "rejected") {
          return challenge("PAYMENT_INVALID", outcome.requirements, outcome.reason);
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
