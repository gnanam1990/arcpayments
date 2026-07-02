import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { LocalWallet, type PaidResponse, type PaidToolTransport } from "arcpayments";
import type { ExactPaymentPayload, PaymentRequirements, ResourceInfo } from "arcpayments";

/**
 * Buyer agent glue for metered-mcp: adapt an MCP `Client` tool call into the
 * transport-agnostic `PaidToolTransport` from arcpayments, so `payForCall` /
 * `startPaymentLoop` drive the paid tool. Maps the in-band x402 envelope
 * (ADR-0001) back into structured challenge/result/rejection responses.
 */
export function mcpPaidToolTransport(
  client: Client,
  toolName: string,
  baseArgs: Record<string, unknown> = {},
): PaidToolTransport {
  return {
    async request(payment?: ExactPaymentPayload): Promise<PaidResponse> {
      const result = await client.callTool({
        name: toolName,
        arguments: { ...baseArgs, ...(payment ? { payment } : {}) },
      });
      const content = result.content as Array<{ text?: string }> | undefined;
      const first = content?.[0]?.text ?? "";

      if (result.isError) {
        const envelope = JSON.parse(first) as {
          error?: string;
          reason?: string;
          resource?: ResourceInfo;
          accepts?: unknown[];
        };
        const requirements = envelope.accepts?.[0] as PaymentRequirements;
        const resource = envelope.resource;
        if (envelope.error === "PAYMENT_REQUIRED") {
          return { kind: "challenge", requirements, ...(resource ? { resource } : {}) };
        }
        return {
          kind: "rejected",
          reason: envelope.reason ?? envelope.error ?? "rejected",
          requirements,
          ...(resource ? { resource } : {}),
        };
      }

      return { kind: "result", content: first };
    },
  };
}

/** Resolve the buyer wallet from env via the arcpayments `Wallet` seam (never logs the key). */
export function resolveBuyerWallet(
  env: Record<string, string | undefined> = process.env,
): LocalWallet | undefined {
  const key = env.BUYER_PRIVATE_KEY?.trim();
  return key ? LocalWallet.fromPrivateKey(key as `0x${string}`) : undefined;
}
