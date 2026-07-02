import {
  type Account,
  type Address,
  getAddress,
  type Hex,
  parseUnits,
  recoverTypedDataAddress,
} from "viem";

/**
 * Transport-agnostic x402 paywall core (ADR-0001).
 *
 * Wire types mirror the x402 **exact-EVM** standard (EIP-3009
 * `transferWithAuthorization`), so this same core drives the in-band MCP
 * challenge today and a Streamable-HTTP 402 later without changes. Amounts are
 * **USDC ERC-20 base units (6 decimals)** — never the 18-decimal native scale.
 */

/** EIP-712 typed-data for an EIP-3009 transfer authorization (matches @x402/evm). */
export const EIP3009_TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** An EIP-3009 transfer authorization (amounts/times as decimal strings). */
export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

/** x402 exact-EVM payment proof the buyer sends back with the retry. */
export interface ExactPaymentPayload {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: { signature: Hex; authorization: Eip3009Authorization };
}

/** x402 payment requirements — the challenge returned when payment is missing/invalid. */
export interface PaymentRequirements {
  scheme: "exact";
  /** CAIP-2 network id, e.g. "eip155:5042002". */
  network: string;
  /** USDC ERC-20 asset address. */
  asset: Address;
  /** Required amount in base units (6-decimal USDC), as a decimal string. */
  amount: string;
  /** Seller payout address. */
  payTo: Address;
  maxTimeoutSeconds: number;
  /** EIP-712 domain data the buyer needs to sign (name/version/verifyingContract). */
  extra: { name: string; version: string; verifyingContract: Address };
}

/** Inputs to build a challenge for one priced resource. */
export interface PaywallConfig {
  /** Human price string, e.g. "$0.001". */
  price: string;
  payTo: Address;
  caip2: string;
  asset: Address;
  /** USDC ERC-20 decimals (must be the 6-decimal constant, never 18). */
  usdcDecimals: number;
  eip712: { name: string; version: string };
  maxTimeoutSeconds?: number;
}

const PRICE_RE = /^\$?(\d+(?:\.\d+)?)$/;

/** Convert a `$0.001`-style price to token base units at the given decimals. */
export function priceToBaseUnits(price: string, decimals: number): bigint {
  const match = PRICE_RE.exec(price.trim());
  if (!match?.[1]) {
    throw new Error(`Invalid price "${price}" — expected a dollar amount like "$0.001".`);
  }
  return parseUnits(match[1], decimals);
}

/** Build the x402 `exact` payment requirements (the 402 challenge). */
export function buildPaymentRequirements(config: PaywallConfig): PaymentRequirements {
  const asset = getAddress(config.asset);
  return {
    scheme: "exact",
    network: config.caip2,
    asset,
    amount: priceToBaseUnits(config.price, config.usdcDecimals).toString(),
    payTo: getAddress(config.payTo),
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
    extra: { name: config.eip712.name, version: config.eip712.version, verifyingContract: asset },
  };
}

function chainIdFromCaip2(caip2: string): number {
  const match = /^eip155:(\d+)$/.exec(caip2);
  if (!match?.[1]) {
    throw new Error(`Unsupported network (expected "eip155:<id>"): ${caip2}`);
  }
  return Number(match[1]);
}

function domainFor(requirements: PaymentRequirements) {
  return {
    name: requirements.extra.name,
    version: requirements.extra.version,
    chainId: chainIdFromCaip2(requirements.network),
    verifyingContract: getAddress(requirements.asset),
  } as const;
}

/** Options for signing a payment (minimal test payer; the buyer agent is Stage 4). */
export interface SignExactOptions {
  nonce: Hex;
  now?: number;
  validAfter?: number;
  validBefore?: number;
}

/**
 * Sign an x402 exact-EVM payment for the given requirements, using the Wallet
 * seam's viem account (`wallet.getAccount()`). No broadcast — this is an offchain
 * EIP-3009 authorization, settled later in a batch.
 */
export async function signExactPayment(
  account: Account,
  requirements: PaymentRequirements,
  options: SignExactOptions,
): Promise<ExactPaymentPayload> {
  if (!account.signTypedData) {
    throw new Error("signer account cannot sign typed data (needs a local/private-key account)");
  }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const validAfter = String(options.validAfter ?? 0);
  const validBefore = String(options.validBefore ?? now + requirements.maxTimeoutSeconds);
  const authorization: Eip3009Authorization = {
    from: getAddress(account.address),
    to: getAddress(requirements.payTo),
    value: requirements.amount,
    validAfter,
    validBefore,
    nonce: options.nonce,
  };
  const signature = await account.signTypedData({
    domain: domainFor(requirements),
    types: EIP3009_TRANSFER_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce: authorization.nonce,
    },
  });
  return { x402Version: 1, scheme: "exact", network: requirements.network, payload: { signature, authorization } };
}

/** Verification outcome. */
export type VerifyResult = { ok: true; payer: Address } | { ok: false; reason: string };

/** Seam for verifying a payment (local for the happy path; mockable in tests). */
export interface PaymentVerifier {
  verify(
    payment: ExactPaymentPayload,
    requirements: PaymentRequirements,
    now: number,
  ): Promise<VerifyResult>;
}

/** Tracks used nonces so a payment proof is single-use (replay protection). */
export interface NonceStore {
  has(nonce: Hex): boolean;
  add(nonce: Hex): void;
}

/** In-memory nonce store (per-process; a durable store swaps in for production). */
export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Set<string>();
  has(nonce: Hex): boolean {
    return this.seen.has(nonce.toLowerCase());
  }
  add(nonce: Hex): void {
    this.seen.add(nonce.toLowerCase());
  }
}

const NONCE_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Local x402 exact-EVM verifier.
 *
 * Validates the payment **authorization against the Gateway's rules** so an
 * accepted payment will actually settle: recipient, amount ≥ price, validity
 * window (expiry), single-use nonce (replay), and the EIP-3009 signature. No
 * network — pure crypto + checks. On success the nonce is consumed.
 */
export class LocalExactVerifier implements PaymentVerifier {
  constructor(private readonly nonces: NonceStore = new InMemoryNonceStore()) {}

  async verify(
    payment: ExactPaymentPayload,
    requirements: PaymentRequirements,
    now: number,
  ): Promise<VerifyResult> {
    if (payment.scheme !== "exact") return { ok: false, reason: "unsupported payment scheme" };
    if (payment.network !== requirements.network) return { ok: false, reason: "network mismatch" };

    const auth = payment.payload?.authorization;
    const signature = payment.payload?.signature;
    if (!auth || !signature) return { ok: false, reason: "malformed payment payload" };

    if (getAddress(auth.to) !== getAddress(requirements.payTo)) {
      return { ok: false, reason: "wrong recipient (payTo mismatch)" };
    }

    let value: bigint;
    let required: bigint;
    let validAfter: bigint;
    let validBefore: bigint;
    try {
      value = BigInt(auth.value);
      required = BigInt(requirements.amount);
      validAfter = BigInt(auth.validAfter);
      validBefore = BigInt(auth.validBefore);
    } catch {
      return { ok: false, reason: "malformed authorization fields" };
    }

    if (value < required) {
      return { ok: false, reason: `insufficient amount: ${value} < required ${required}` };
    }

    const nowBig = BigInt(Math.floor(now));
    if (nowBig < validAfter) return { ok: false, reason: "payment not yet valid" };
    if (nowBig >= validBefore) return { ok: false, reason: "payment authorization expired" };

    if (!NONCE_RE.test(auth.nonce)) return { ok: false, reason: "invalid nonce format" };
    if (this.nonces.has(auth.nonce)) return { ok: false, reason: "replayed nonce (proof already used)" };

    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain: domainFor(requirements),
        types: EIP3009_TRANSFER_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: getAddress(auth.from),
          to: getAddress(auth.to),
          value,
          validAfter,
          validBefore,
          nonce: auth.nonce,
        },
        signature,
      });
    } catch {
      return { ok: false, reason: "signature verification failed" };
    }
    if (getAddress(recovered) !== getAddress(auth.from)) {
      return { ok: false, reason: "signature does not match the payer" };
    }

    this.nonces.add(auth.nonce);
    return { ok: true, payer: getAddress(auth.from) };
  }
}

/** Lifecycle of a queued payment awaiting batch settlement. */
export type SettlementStatus = "queued" | "settled" | "failed";

/** A payment verified and queued for Circle Gateway batch settlement. */
export interface SettlementRecord {
  id: string;
  payer: Address;
  amount: string;
  network: string;
  status: SettlementStatus;
  transaction?: string;
  error?: string;
  enqueuedAt: number;
  payment: ExactPaymentPayload;
  requirements: PaymentRequirements;
}

/** Fields the caller supplies when enqueuing (id/status are assigned by the queue). */
export type SettlementInput = Omit<SettlementRecord, "id" | "status">;

/** Queue of verified payments awaiting batch settlement. */
export interface SettlementQueue {
  enqueue(input: SettlementInput): SettlementRecord;
  all(): SettlementRecord[];
  pending(): SettlementRecord[];
  failed(): SettlementRecord[];
}

/** In-memory settlement queue. Failed settlements stay visible via {@link failed}. */
export class InMemorySettlementQueue implements SettlementQueue {
  private readonly records: SettlementRecord[] = [];
  private seq = 0;

  enqueue(input: SettlementInput): SettlementRecord {
    const record: SettlementRecord = { ...input, id: `stl_${++this.seq}`, status: "queued" };
    this.records.push(record);
    return record;
  }
  all(): SettlementRecord[] {
    return [...this.records];
  }
  pending(): SettlementRecord[] {
    return this.records.filter((r) => r.status === "queued");
  }
  failed(): SettlementRecord[] {
    return this.records.filter((r) => r.status === "failed");
  }
}

/** Result of settling one record with the (batching) facilitator. */
export interface SettlementOutcome {
  success: boolean;
  transaction?: string;
  error?: string;
}

/** Seam for the network settlement backend (Circle Gateway in production). */
export interface Settler {
  settle(record: SettlementRecord): Promise<SettlementOutcome>;
}

export interface FlushResult {
  settled: SettlementRecord[];
  failed: SettlementRecord[];
}

/**
 * Flush all pending records through the settler (batch settlement).
 *
 * A failed or throwing settle marks the record `failed` **and keeps it in the
 * queue** (surfaced via {@link SettlementQueue.failed}) — never silently dropped.
 */
export async function flushSettlements(queue: SettlementQueue, settler: Settler): Promise<FlushResult> {
  const settled: SettlementRecord[] = [];
  const failed: SettlementRecord[] = [];
  for (const record of queue.pending()) {
    try {
      const outcome = await settler.settle(record);
      if (outcome.success) {
        record.status = "settled";
        if (outcome.transaction) record.transaction = outcome.transaction;
        settled.push(record);
      } else {
        record.status = "failed";
        record.error = outcome.error ?? "settlement failed";
        failed.push(record);
      }
    } catch (err) {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      failed.push(record);
    }
  }
  return { settled, failed };
}

/** Config for {@link PaywallGuard}. */
export interface PaywallGuardConfig {
  requirements: PaymentRequirements;
  verifier: PaymentVerifier;
  queue: SettlementQueue;
  /** Clock (unix seconds). Injectable for deterministic tests. */
  now?: () => number;
}

/** What the guard decided for one call. */
export type GuardOutcome<T> =
  | { status: "payment-required"; requirements: PaymentRequirements }
  | { status: "rejected"; reason: string; requirements: PaymentRequirements }
  | { status: "ok"; result: T; settlement: SettlementRecord };

/**
 * Transport-agnostic paywall guard. Given the (optional) payment proof for a
 * call, it either challenges, rejects, or verifies-then-runs the handler and
 * enqueues the payment for batch settlement. The handler runs **only** after a
 * valid payment.
 */
export class PaywallGuard {
  constructor(private readonly config: PaywallGuardConfig) {}

  get requirements(): PaymentRequirements {
    return this.config.requirements;
  }

  async guard<T>(
    payment: ExactPaymentPayload | undefined,
    run: () => Promise<T>,
  ): Promise<GuardOutcome<T>> {
    if (!payment) {
      return { status: "payment-required", requirements: this.config.requirements };
    }
    const now = (this.config.now ?? (() => Math.floor(Date.now() / 1000)))();
    const verdict = await this.config.verifier.verify(payment, this.config.requirements, now);
    if (!verdict.ok) {
      return { status: "rejected", reason: verdict.reason, requirements: this.config.requirements };
    }
    const result = await run();
    const settlement = this.config.queue.enqueue({
      payer: verdict.payer,
      amount: this.config.requirements.amount,
      network: this.config.requirements.network,
      payment,
      requirements: this.config.requirements,
      enqueuedAt: now,
    });
    return { status: "ok", result, settlement };
  }
}
