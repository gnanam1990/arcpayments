import {
  type GatewayBalanceReport,
  type SettlementRecord,
  type SpendGuardSnapshot,
  isOnChainTxHash,
} from "arcpayments";
import { formatUnits } from "viem";

/**
 * Pure view-model for the seller dashboard (Stage 7).
 *
 * Turns REAL sources — the Stage 4 settlement queue, the `gateway:balance` report,
 * and the Stage 6 guard snapshot — into a JSON-serializable model the read-only UI
 * renders. No invented data: empty inputs yield honest empty states, and a Gateway
 * settlement id (a UUID, not a hash) is NEVER turned into an explorer link.
 */

const USDC_DECIMALS = 6;

/** Format 6-decimal USDC base units (string or bigint) as a decimal string. */
function formatUsdc(baseUnits: string | bigint): string {
  return formatUnits(BigInt(baseUnits), USDC_DECIMALS);
}

/** `0x824c…9f1a` — first 4 + last 4 hex, or `—` for a missing address. */
export function truncateAddress(address: string | null | undefined): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Dashboard-facing lifecycle: honest about accepted (off-chain) vs completed (on-chain). */
export type FeedStatus = "queued" | "accepted" | "completed" | "failed";

export interface FeedRow {
  id: string;
  amount: string; // formatted USDC, e.g. "0.001"
  amountBaseUnits: string;
  payer: string;
  payerShort: string;
  status: FeedStatus;
  at: number;
  /** A real on-chain 0x hash, if one exists (Gateway transfers usually have none). */
  txHash?: string;
  /** Circle's settlement/transfer id (a UUID, NOT a hash) — shown, never linked. */
  settlementId?: string;
  error?: string;
}

export interface BalanceCard {
  state: "ok" | "unavailable";
  address: string | null;
  addressShort: string | null;
  available: string | null;
  deposited: string | null;
  withdrawing: string | null;
  withdrawable: string | null;
  wallet: string | null;
  error?: string;
}

export interface SettlementSummary {
  queued: number;
  accepted: number;
  completed: number;
  failed: number;
  earnedBaseUnits: string;
  earned: string;
  note: string;
}

export interface DenialRecord {
  guard: string;
  reason: string;
  recipient: string;
  amount: bigint;
  at: number;
}

export interface DenialRow {
  guard: string;
  reason: string;
  payerShort: string;
  amount: string;
  at: number;
}

export interface SafetyPanel {
  configured: boolean;
  budget?: {
    used: string;
    usedBaseUnits: string;
    cap?: string;
    capBaseUnits?: string;
    pct?: number;
  };
  rate?: { used: number; max: number; headroom: number; windowMs: number };
  perPaymentMax?: string;
  humanGateThreshold?: string;
  allowlist: string[];
  allowlistSize: number;
  denials: DenialRow[];
}

export interface DashboardModel {
  seller: { address: string | null; addressShort: string | null; network: string; price: string };
  feed: FeedRow[];
  balance: BalanceCard;
  settlement: SettlementSummary;
  safety: SafetyPanel;
  generatedAt: number;
}

export interface DashboardInput {
  seller: { address: string | null; network: string; price: string };
  records: SettlementRecord[];
  /** From `runGatewayBalance`. `undefined` ⇒ no reader configured (honest "unavailable"). */
  balance?: GatewayBalanceReport;
  /** From `SpendGuard.snapshot()`. `undefined` ⇒ no guard configured. */
  guard?: SpendGuardSnapshot;
  denials?: DenialRecord[];
  /** Ids known **on-chain completed** (real signal only; empty by default). */
  completedIds?: ReadonlySet<string>;
  now: number;
}

const SETTLEMENT_NOTE =
  "Accepted = Gateway credited off-chain instantly. On-chain settlement follows in the background (~10 min); Circle exposes no per-transfer hash, so completed is shown only when independently confirmed.";

function feedStatus(record: SettlementRecord, completedIds: ReadonlySet<string>): FeedStatus {
  if (record.status === "failed") return "failed";
  if (record.status === "queued") return "queued";
  // record.status === "settled" → Gateway ACCEPTED (off-chain); only "completed"
  // when an independent on-chain confirmation says so.
  return completedIds.has(record.id) ? "completed" : "accepted";
}

function buildFeed(records: SettlementRecord[], completedIds: ReadonlySet<string>): FeedRow[] {
  return [...records]
    .sort((a, b) => b.enqueuedAt - a.enqueuedAt)
    .map((record) => {
      const txHash =
        record.transaction && isOnChainTxHash(record.transaction) ? record.transaction : undefined;
      return {
        id: record.id,
        amount: formatUsdc(record.amount),
        amountBaseUnits: record.amount,
        payer: record.payer,
        payerShort: truncateAddress(record.payer),
        status: feedStatus(record, completedIds),
        at: record.enqueuedAt,
        ...(txHash ? { txHash } : {}),
        ...(!txHash && record.transaction ? { settlementId: record.transaction } : {}),
        ...(record.error ? { error: record.error } : {}),
      };
    });
}

function buildBalance(report: GatewayBalanceReport | undefined): BalanceCard {
  const unavailable = (error: string): BalanceCard => ({
    state: "unavailable",
    address: null,
    addressShort: null,
    available: null,
    deposited: null,
    withdrawing: null,
    withdrawable: null,
    wallet: null,
    error,
  });
  if (!report) {
    return unavailable(
      "Balance needs a seller key and network. Set SELLER_PRIVATE_KEY to read the Gateway balance (read-only; the key stays server-side).",
    );
  }
  if (!report.ok || !report.balances) {
    return unavailable(`Couldn't read the balance: ${report.error ?? "unknown error"}.`);
  }
  const b = report.balances;
  return {
    state: "ok",
    address: b.address,
    addressShort: truncateAddress(b.address),
    available: b.gatewayAvailableFormatted,
    deposited: b.gatewayTotalFormatted,
    withdrawing: b.gatewayWithdrawingFormatted,
    withdrawable: b.gatewayWithdrawableFormatted,
    wallet: b.walletFormatted,
  };
}

function buildSettlement(
  records: SettlementRecord[],
  completedIds: ReadonlySet<string>,
): SettlementSummary {
  let queued = 0;
  let accepted = 0;
  let completed = 0;
  let failed = 0;
  let earned = 0n;
  for (const record of records) {
    const status = feedStatus(record, completedIds);
    if (status === "queued") queued += 1;
    else if (status === "failed") failed += 1;
    else {
      // accepted or completed both represent money the seller has earned
      if (status === "completed") completed += 1;
      else accepted += 1;
      earned += BigInt(record.amount);
    }
  }
  return {
    queued,
    accepted,
    completed,
    failed,
    earnedBaseUnits: earned.toString(),
    earned: formatUsdc(earned),
    note: SETTLEMENT_NOTE,
  };
}

function buildSafety(guard: SpendGuardSnapshot | undefined, denials: DenialRecord[]): SafetyPanel {
  const denialRows: DenialRow[] = denials.map((d) => ({
    guard: d.guard,
    reason: d.reason,
    payerShort: truncateAddress(d.recipient),
    amount: formatUsdc(d.amount),
    at: d.at,
  }));
  if (!guard) {
    return { configured: false, allowlist: [], allowlistSize: 0, denials: denialRows };
  }
  const panel: SafetyPanel = {
    configured: true,
    allowlist: (guard.allowlist ?? []).map((a) => truncateAddress(a)),
    allowlistSize: guard.allowlist?.length ?? 0,
    denials: denialRows,
  };
  if (guard.budgetCap !== undefined) {
    const pct =
      guard.budgetCap > 0n ? Math.round(Number((guard.spent * 10000n) / guard.budgetCap) / 100) : 0;
    panel.budget = {
      used: formatUsdc(guard.spent),
      usedBaseUnits: guard.spent.toString(),
      cap: formatUsdc(guard.budgetCap),
      capBaseUnits: guard.budgetCap.toString(),
      pct,
    };
  } else {
    panel.budget = { used: formatUsdc(guard.spent), usedBaseUnits: guard.spent.toString() };
  }
  if (guard.rate) panel.rate = { ...guard.rate };
  if (guard.perPaymentMax !== undefined) panel.perPaymentMax = formatUsdc(guard.perPaymentMax);
  if (guard.humanGateThreshold !== undefined)
    panel.humanGateThreshold = formatUsdc(guard.humanGateThreshold);
  return panel;
}

/** Build the full dashboard model from real sources. Pure + JSON-serializable. */
export function buildDashboardModel(input: DashboardInput): DashboardModel {
  const completedIds = input.completedIds ?? new Set<string>();
  return {
    seller: {
      address: input.seller.address,
      addressShort: input.seller.address ? truncateAddress(input.seller.address) : null,
      network: input.seller.network,
      price: input.seller.price,
    },
    feed: buildFeed(input.records, completedIds),
    balance: buildBalance(input.balance),
    settlement: buildSettlement(input.records, completedIds),
    safety: buildSafety(input.guard, input.denials ?? []),
    generatedAt: input.now,
  };
}
