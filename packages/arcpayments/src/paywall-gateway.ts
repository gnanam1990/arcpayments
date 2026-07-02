import { GatewayClient } from "@circle-fin/x402-batching/client";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import type { Address } from "viem";
import type { BatchSettleOutcome, BatchSettler } from "./buyer";
import type { GatewayBalanceReader, GatewayBalances } from "./gateway-balance";
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

/**
 * x402 PaymentPayload shape the Gateway facilitator expects (mirrors the SDK).
 * `resource` + `accepted` are API-required by Gateway `/verify` + `/settle`
 * (see ADR-0001); the SDK sends them as top-level siblings of `payload`.
 */
interface SdkPaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: Record<string, unknown>;
  resource?: Record<string, unknown>;
  accepted?: Record<string, unknown>;
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

/** The raw facilitator response — kept as-is so NOTHING (reason/code/body) is lost. */
export type FacilitatorResponse = Record<string, unknown>;

/** The subset of the Gateway facilitator we use — `verify` + `settle`. */
export interface FacilitatorLike {
  verify(
    payload: SdkPaymentPayload,
    requirements: SdkPaymentRequirements,
  ): Promise<FacilitatorResponse>;
  settle(
    payload: SdkPaymentPayload,
    requirements: SdkPaymentRequirements,
  ): Promise<FacilitatorResponse>;
}

function toSdkPayload(payment: ExactPaymentPayload): SdkPaymentPayload {
  return {
    x402Version: payment.x402Version,
    scheme: payment.scheme,
    network: payment.network,
    payload: payment.payload as unknown as Record<string, unknown>,
    // Gateway-required (SDK-optional) metadata — see ADR-0001.
    ...(payment.resource
      ? { resource: payment.resource as unknown as Record<string, unknown> }
      : {}),
    ...(payment.accepted
      ? { accepted: payment.accepted as unknown as Record<string, unknown> }
      : {}),
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

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Known reason/code fields Circle Gateway may use — surfaced for readability. */
const REASON_KEYS = [
  "errorReason",
  "invalidReason",
  "error",
  "message",
  "reason",
  "code",
  "detail",
  "details",
] as const;

/**
 * Turn a raw Gateway response into a **complete** error string: any recognizable
 * reason/code fields PLUS the full response body verbatim. Never collapses to a
 * generic "settlement failed".
 */
export function describeGatewayError(raw: FacilitatorResponse): string {
  const parts: string[] = [];
  for (const key of REASON_KEYS) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${key}=${typeof value === "string" ? value : safeJson(value)}`);
    }
  }
  const full = safeJson(raw);
  if (parts.length === 0) {
    return full === "{}" ? "gateway rejected (empty response body)" : full;
  }
  return `${parts.join(", ")} | full: ${full}`;
}

/** Turn a thrown error into a complete string, preserving the SDK's status+body message. */
export function describeThrownError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause !== undefined ? `${err.message} | cause: ${safeJson(cause)}` : err.message;
  }
  return safeJson(err);
}

/** Map a raw settle response to a {@link SettlementOutcome}, surfacing the full error. */
export function settlementOutcomeFrom(raw: FacilitatorResponse): SettlementOutcome {
  if (raw.success === true) {
    const tx = raw.transaction;
    return { success: true, ...(typeof tx === "string" && tx ? { transaction: tx } : {}) };
  }
  return { success: false, error: describeGatewayError(raw) };
}

/** Outcome of a preflight `/verify` against Gateway (for `--verify-only`). */
export interface GatewayVerifyResult {
  ok: boolean;
  /** The raw facilitator `/verify` response, verbatim (for printing). */
  raw?: FacilitatorResponse;
  /** Present when the call threw — the full status+body message. */
  error?: string;
}

/** Settle verified payments through Circle Gateway (batched). */
export class GatewaySettler implements Settler {
  constructor(private readonly facilitator: FacilitatorLike) {}

  /** Build a settler pointed at a Gateway facilitator URL (from the network config). */
  static create(opts: { gatewayUrl: string }): GatewaySettler {
    return new GatewaySettler(gatewayFacilitator(opts.gatewayUrl));
  }

  async settle(record: SettlementRecord): Promise<SettlementOutcome> {
    try {
      const raw = await this.facilitator.settle(
        toSdkPayload(record.payment),
        toSdkRequirements(record.requirements),
      );
      return settlementOutcomeFrom(raw);
    } catch (err) {
      return { success: false, error: describeThrownError(err) };
    }
  }
}

/**
 * Batch settlement backend for the buyer loop's `flushBatch`.
 *
 * Submits each queued authorization to Circle Gateway in one flush operation;
 * Gateway aggregates them into a **single on-chain settlement transaction** (the
 * SDK exposes only a per-authorization `settle`, so batching is Gateway-side).
 * Per-authorization failures are surfaced **with the full Gateway response**,
 * never dropped or collapsed to a generic message.
 */
export class GatewayBatchSettler implements BatchSettler {
  constructor(private readonly facilitator: FacilitatorLike) {}

  /** Build a batch settler pointed at a Gateway facilitator URL (from the network config). */
  static create(opts: { gatewayUrl: string }): GatewayBatchSettler {
    return new GatewayBatchSettler(gatewayFacilitator(opts.gatewayUrl));
  }

  /**
   * Preflight one payment against Gateway `/verify` and return the RAW response
   * (or the full thrown error). Use this to see exactly why a payment is rejected
   * before settling a whole batch.
   */
  async verify(record: SettlementRecord): Promise<GatewayVerifyResult> {
    try {
      const raw = await this.facilitator.verify(
        toSdkPayload(record.payment),
        toSdkRequirements(record.requirements),
      );
      return { ok: raw.isValid === true, raw };
    } catch (err) {
      return { ok: false, error: describeThrownError(err) };
    }
  }

  async settleBatch(records: SettlementRecord[]): Promise<BatchSettleOutcome> {
    const settled: string[] = [];
    const failed: { id: string; error: string }[] = [];
    let transaction: string | undefined;

    for (const record of records) {
      try {
        const raw = await this.facilitator.settle(
          toSdkPayload(record.payment),
          toSdkRequirements(record.requirements),
        );
        const outcome = settlementOutcomeFrom(raw);
        if (outcome.success) {
          settled.push(record.id);
          if (outcome.transaction) transaction = outcome.transaction;
        } else {
          failed.push({ id: record.id, error: outcome.error ?? describeGatewayError(raw) });
        }
      } catch (err) {
        failed.push({ id: record.id, error: describeThrownError(err) });
      }
    }

    return { ...(transaction ? { transaction } : {}), settled, failed };
  }
}

/**
 * Wrap the SDK `BatchFacilitatorClient` as a {@link FacilitatorLike}, returning the
 * raw `/verify` and `/settle` responses. The SDK's public types don't export the
 * payload/requirements interfaces; the runtime shapes match, so cast only here.
 */
function gatewayFacilitator(gatewayUrl: string): FacilitatorLike {
  const client = new BatchFacilitatorClient({ url: gatewayUrl });
  return {
    verify: (payload, requirements) =>
      client.verify(
        payload as never,
        requirements as never,
      ) as unknown as Promise<FacilitatorResponse>,
    settle: (payload, requirements) =>
      client.settle(
        payload as never,
        requirements as never,
      ) as unknown as Promise<FacilitatorResponse>,
  };
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

/**
 * Real Circle Gateway balance reader — the **same** `GatewayClient` that
 * {@link createGatewayDepositor} uses. Reads deposited vs available balances via
 * `GatewayClient.getBalances()`. On-chain/API — never invoked in CI.
 */
export function createGatewayBalanceReader(opts: {
  privateKey: `0x${string}`;
  chain: string;
  rpcUrl?: string;
}): GatewayBalanceReader {
  const client = new GatewayClient({
    chain: opts.chain as never,
    privateKey: opts.privateKey,
    ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
  });
  return {
    getBalances: async (address): Promise<GatewayBalances> => {
      const b = await client.getBalances(address as Address | undefined);
      return {
        address: address ?? client.address,
        walletFormatted: b.wallet.formatted,
        gatewayTotalFormatted: b.gateway.formattedTotal,
        gatewayAvailableFormatted: b.gateway.formattedAvailable,
        gatewayWithdrawingFormatted: b.gateway.formattedWithdrawing,
        gatewayWithdrawableFormatted: b.gateway.formattedWithdrawable,
      };
    },
  };
}
