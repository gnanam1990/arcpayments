import { isOnChainTxHash } from "./gateway-settlement";
import { type PollOptions, pollWithBackoff } from "./poll";

/**
 * `arcpayments cctp:transfer` core (Stage 5, ADR-0002).
 *
 * Bridges the seller's Arc USDC to a destination chain via **CCTP v2**
 * (burn on Arc → Circle attestation → mint on the destination). CCTP **burns**
 * USDC — irreversible — so this core validates inputs BEFORE touching the bridge
 * and never fabricates a hash: burn/mint refs are built only from real `0x`
 * hashes, and a failed burn never reports a mint.
 *
 * The real backend is @circle-fin/bridge-kit (see `createCctpBridge` in
 * paywall-gateway.ts); CI drives the `CctpBridge` seam with mocks only.
 */

/** A single CCTP step surfaced by the bridge (Approve / Burn / Mint). */
export interface CctpStep {
  name: string;
  state: "pending" | "success" | "error" | "noop";
  txHash?: string;
  explorerUrl?: string;
}

/** Bridge result (mirrors bridge-kit's `BridgeResult`, plus an optional poll ref). */
export interface CctpBridgeResult {
  state: "pending" | "success" | "error";
  steps: CctpStep[];
  error?: string;
  /** Opaque handle for polling a still-pending transfer via `status()`. */
  ref?: string;
}

export interface CctpBridgeParams {
  amount: string;
  toChain: string;
  recipient?: string;
}

/** Seam for the CCTP backend — mockable in CI, real `BridgeKit` in prod. */
export interface CctpBridge {
  bridge(params: CctpBridgeParams): Promise<CctpBridgeResult>;
  /** Optional: re-check a pending transfer (used for attestation polling). */
  status?(ref: string): Promise<CctpBridgeResult>;
}

/** A resolved on-chain reference (only ever built from a real `0x` hash). */
export interface CctpTxRef {
  txHash: string;
  explorerUrl?: string;
}

export interface CctpTransferReport {
  ok: boolean;
  state: CctpBridgeResult["state"];
  amount: string;
  toChain: string;
  error?: string;
  burn?: CctpTxRef;
  mint?: CctpTxRef;
  steps: CctpStep[];
}

export interface RunCctpOptions {
  /** Backoff config for polling a pending transfer. */
  poll?: PollOptions;
}

const AMOUNT_RE = /^\d+(?:\.\d+)?$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Find a step by name (case-insensitive) and return its ref iff the hash is real `0x`. */
function txRef(steps: CctpStep[], name: string): CctpTxRef | undefined {
  const step = steps.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!step || step.state === "error" || !step.txHash || !isOnChainTxHash(step.txHash)) {
    return undefined;
  }
  return { txHash: step.txHash, ...(step.explorerUrl ? { explorerUrl: step.explorerUrl } : {}) };
}

/**
 * Run a CCTP transfer end-to-end. Validates the amount and (optional) recipient
 * BEFORE invoking the bridge; if the transfer comes back `pending` and the bridge
 * exposes `status()`, polls with exponential backoff until it resolves or times
 * out. Surfaces burn/mint hashes (real `0x` only); a failed burn yields no mint.
 */
export async function runCctpTransfer(
  bridge: CctpBridge,
  params: CctpBridgeParams,
  options: RunCctpOptions = {},
): Promise<CctpTransferReport> {
  const base = {
    ok: false,
    state: "error" as const,
    amount: params.amount,
    toChain: params.toChain,
    steps: [],
  };

  const amount = params.amount?.trim();
  if (!amount || !AMOUNT_RE.test(amount) || Number(amount) <= 0) {
    return {
      ...base,
      error: `invalid amount "${params.amount}" — expected a positive USDC amount.`,
    };
  }
  if (!params.toChain?.trim()) {
    return { ...base, error: "missing destination chain (--to)." };
  }
  if (params.recipient && !ADDRESS_RE.test(params.recipient)) {
    return { ...base, error: `invalid recipient address "${params.recipient}".` };
  }

  let result: CctpBridgeResult;
  try {
    result = await bridge.bridge(params);
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  // Poll a still-pending transfer (attestation not yet available) with backoff.
  if (result.state === "pending" && result.ref && bridge.status) {
    const ref = result.ref;
    const status = bridge.status.bind(bridge);
    const outcome = await pollWithBackoff(
      () => status(ref),
      (r) => r.state !== "pending",
      options.poll,
    );
    result = outcome.value;
    if (result.state === "pending") {
      const burn = txRef(result.steps, "Burn");
      return {
        ok: false,
        state: "pending",
        amount,
        toChain: params.toChain,
        steps: result.steps,
        ...(burn ? { burn } : {}),
        error:
          "transfer still pending after polling timed out — the burn may have landed; re-check attestation before retrying (do NOT re-burn).",
      };
    }
  }

  const burnStep = result.steps.find((s) => s.name.toLowerCase() === "burn");
  const burnFailed = burnStep?.state === "error";
  const ok = result.state === "success";
  const burn = txRef(result.steps, "Burn");
  // A failed burn never proceeds to mint; a succeeded burn with a placeholder
  // hash still may have minted, so gate on burn *failure*, not on the ref.
  const mint = burnFailed ? undefined : txRef(result.steps, "Mint");
  return {
    ok,
    state: result.state,
    amount,
    toChain: params.toChain,
    steps: result.steps,
    ...(burn ? { burn } : {}),
    ...(mint ? { mint } : {}),
    ...(ok ? {} : { error: result.error ?? "CCTP transfer failed." }),
  };
}

/** Render a CCTP report. Burn/mint links come only from real `0x` hashes. */
export function formatCctpReport(report: CctpTransferReport): string {
  if (!report.ok) {
    const lines = [`cctp:transfer failed (${report.state}): ${report.error ?? "unknown error"}`];
    if (report.burn) {
      lines.push(`  burn tx (source, USDC already burned): ${report.burn.txHash}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const lines = [`cctp:transfer — bridged ${report.amount} USDC to ${report.toChain} via CCTP v2`];
  if (report.burn) {
    lines.push(`  burn tx (Arc):  ${report.burn.txHash}`);
    if (report.burn.explorerUrl) lines.push(`    ${report.burn.explorerUrl}`);
  }
  if (report.mint) {
    lines.push(`  mint tx (${report.toChain}): ${report.mint.txHash}`);
    if (report.mint.explorerUrl) lines.push(`    ${report.mint.explorerUrl}`);
  }
  return `${lines.join("\n")}\n`;
}
