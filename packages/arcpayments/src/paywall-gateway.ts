import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import type {
  ExactPaymentPayload,
  PaymentRequirements,
  SettlementOutcome,
  SettlementRecord,
  Settler,
} from "./paywall";

/**
 * Circle Gateway settlement backend for the paywall (ADR-0001).
 *
 * Wraps `@circle-fin/x402-batching`'s `BatchFacilitatorClient`, which settles
 * signed authorizations via Circle Gateway in **batches** — so we never broadcast
 * a transaction per call. Verification is done locally by `LocalExactVerifier`;
 * this adapter is only the (network) settlement leg.
 */

/** x402 PaymentPayload shape the Gateway facilitator expects (mirrors the SDK). */
interface SdkPaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: Record<string, unknown>;
}

/** x402 PaymentRequirements shape the Gateway facilitator expects (mirrors the SDK). */
interface SdkPaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/** The subset of the Gateway facilitator we use — a `settle` call. */
export interface FacilitatorLike {
  settle(
    payload: SdkPaymentPayload,
    requirements: SdkPaymentRequirements,
  ): Promise<{ success: boolean; errorReason?: string; transaction?: string; network?: string }>;
}

function toSdkPayload(payment: ExactPaymentPayload): SdkPaymentPayload {
  return {
    x402Version: payment.x402Version,
    scheme: payment.scheme,
    network: payment.network,
    payload: payment.payload as unknown as Record<string, unknown>,
  };
}

function toSdkRequirements(requirements: PaymentRequirements): SdkPaymentRequirements {
  return {
    scheme: requirements.scheme,
    network: requirements.network,
    asset: requirements.asset,
    amount: requirements.amount,
    payTo: requirements.payTo,
    maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    extra: requirements.extra as unknown as Record<string, unknown>,
  };
}

/** Settle verified payments through Circle Gateway (batched). */
export class GatewaySettler implements Settler {
  constructor(private readonly facilitator: FacilitatorLike) {}

  /** Build a settler pointed at a Gateway facilitator URL (from the network config). */
  static create(opts: { gatewayUrl: string }): GatewaySettler {
    const client = new BatchFacilitatorClient({ url: opts.gatewayUrl });
    return new GatewaySettler({
      // The SDK's public types don't export the payload/requirements interfaces;
      // the runtime shapes match, so cast only at this external boundary.
      settle: (payload, requirements) =>
        client.settle(payload as never, requirements as never) as Promise<{
          success: boolean;
          errorReason?: string;
          transaction?: string;
          network?: string;
        }>,
    });
  }

  async settle(record: SettlementRecord): Promise<SettlementOutcome> {
    const response = await this.facilitator.settle(
      toSdkPayload(record.payment),
      toSdkRequirements(record.requirements),
    );
    if (response.success) {
      return {
        success: true,
        ...(response.transaction ? { transaction: response.transaction } : {}),
      };
    }
    return { success: false, error: response.errorReason ?? "settlement failed" };
  }
}
