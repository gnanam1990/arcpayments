import { GatewayClient } from "@circle-fin/x402-batching/client";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import type { BatchSettleOutcome, BatchSettler } from "./buyer";
import type { DepositResult, GatewayDepositor } from "./gateway-deposit";
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

/**
 * Batch settlement backend for the buyer loop's `flushBatch`.
 *
 * Submits each queued authorization to Circle Gateway in one flush operation;
 * Gateway aggregates them into a **single on-chain settlement transaction** (the
 * SDK exposes only a per-authorization `settle`, so batching is Gateway-side).
 * Per-authorization failures are surfaced, never dropped.
 */
export class GatewayBatchSettler implements BatchSettler {
  constructor(private readonly facilitator: FacilitatorLike) {}

  /** Build a batch settler pointed at a Gateway facilitator URL (from the network config). */
  static create(opts: { gatewayUrl: string }): GatewayBatchSettler {
    const client = new BatchFacilitatorClient({ url: opts.gatewayUrl });
    return new GatewayBatchSettler({
      settle: (payload, requirements) =>
        client.settle(payload as never, requirements as never) as Promise<{
          success: boolean;
          errorReason?: string;
          transaction?: string;
          network?: string;
        }>,
    });
  }

  async settleBatch(records: SettlementRecord[]): Promise<BatchSettleOutcome> {
    const settled: string[] = [];
    const failed: { id: string; error: string }[] = [];
    let transaction: string | undefined;

    for (const record of records) {
      try {
        const response = await this.facilitator.settle(
          toSdkPayload(record.payment),
          toSdkRequirements(record.requirements),
        );
        if (response.success) {
          settled.push(record.id);
          if (response.transaction) transaction = response.transaction;
        } else {
          failed.push({ id: record.id, error: response.errorReason ?? "settlement failed" });
        }
      } catch (err) {
        failed.push({ id: record.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { ...(transaction ? { transaction } : {}), settled, failed };
  }
}

/**
 * Real Circle Gateway deposit backend, wrapping the SDK `GatewayClient`
 * (`@circle-fin/x402-batching/client`). Deposits USDC from the wallet into the
 * buyer's Gateway balance (approve + deposit on the GatewayWallet contract), so
 * the x402 buyer loop can settle. On-chain — never invoked in CI.
 */
export function createGatewayDepositor(opts: {
  privateKey: `0x${string}`;
  chain: string;
  rpcUrl?: string;
}): GatewayDepositor {
  const client = new GatewayClient({
    // `chain` is the SDK's SupportedChainName (e.g. "arcTestnet"); read from config.
    chain: opts.chain as never,
    privateKey: opts.privateKey,
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
  });
  return {
    deposit: async (amount): Promise<DepositResult> => {
      const r = await client.deposit(amount);
      return {
        ...(r.approvalTxHash ? { approvalTxHash: r.approvalTxHash } : {}),
        depositTxHash: r.depositTxHash,
        amount: r.amount.toString(),
        formattedAmount: r.formattedAmount,
        depositor: r.depositor,
      };
    },
    availableBalance: async (): Promise<string> => {
      const balances = await client.getBalances();
      return balances.gateway.formattedAvailable;
    },
  };
}
