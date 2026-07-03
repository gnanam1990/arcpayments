import {
  type GatewayBalanceReader,
  type GatewayBalanceReport,
  type SettlementQueue,
  type SpendGuard,
  runGatewayBalance,
} from "arcpayments";
import { type DashboardModel, type DenialRecord, buildDashboardModel } from "./view-model";

/**
 * The single, shared seller state the dashboard reads (Stage 7). The metered-mcp
 * paid tool writes payments into the SAME `queue`, and guard denials are appended
 * here via the guard's `onDeny` hook — so the dashboard shows REAL activity, never
 * invented numbers. Read-only from the browser's side; no key ever leaves the server.
 */
export interface SellerStateOptions {
  queue: SettlementQueue;
  seller: { address: string | null; network: string; price: string };
  /** Stage 6 guard, if the buyer path is guarded — surfaced in the safety panel. */
  guard?: SpendGuard;
  /** Server-side balance reader (needs a key). Absent ⇒ honest "unavailable" card. */
  balanceReader?: GatewayBalanceReader;
  /** Balance-read cache TTL (ms) so the SSE loop doesn't hammer the network. */
  balanceTtlMs?: number;
  now?: () => number;
}

const MAX_DENIALS = 50;

export class SellerState {
  readonly #queue: SettlementQueue;
  readonly #seller: { address: string | null; network: string; price: string };
  readonly #guard?: SpendGuard;
  readonly #balanceReader?: GatewayBalanceReader;
  readonly #balanceTtlMs: number;
  readonly #now: () => number;
  readonly #denials: DenialRecord[] = [];

  #balanceCache?: { report: GatewayBalanceReport; at: number };

  constructor(options: SellerStateOptions) {
    this.#queue = options.queue;
    this.#seller = options.seller;
    if (options.guard) this.#guard = options.guard;
    if (options.balanceReader) this.#balanceReader = options.balanceReader;
    this.#balanceTtlMs = options.balanceTtlMs ?? 8000;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Append a guard denial (wire this to the guard's `onDeny`). */
  recordDenial(denial: Omit<DenialRecord, "at"> & { at?: number }): void {
    this.#denials.unshift({ ...denial, at: denial.at ?? this.#now() });
    if (this.#denials.length > MAX_DENIALS) this.#denials.length = MAX_DENIALS;
  }

  async #balance(): Promise<GatewayBalanceReport | undefined> {
    if (!this.#balanceReader) return undefined;
    const now = this.#now();
    if (this.#balanceCache && now - this.#balanceCache.at < this.#balanceTtlMs) {
      return this.#balanceCache.report;
    }
    const report = await runGatewayBalance(this.#balanceReader, this.#seller.address ?? undefined);
    this.#balanceCache = { report, at: now };
    return report;
  }

  /** Build the current dashboard model from real state (balance read is cached). */
  async model(): Promise<DashboardModel> {
    const balance = await this.#balance();
    return buildDashboardModel({
      seller: this.#seller,
      records: this.#queue.all(),
      ...(balance ? { balance } : {}),
      ...(this.#guard ? { guard: this.#guard.snapshot() } : {}),
      denials: this.#denials,
      now: this.#now(),
    });
  }
}
