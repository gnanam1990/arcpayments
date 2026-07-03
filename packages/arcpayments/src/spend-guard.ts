import { USDC_ERC20_DECIMALS } from "./network";
import { priceToBaseUnits } from "./paywall";

/**
 * SpendGuard — the safety kernel (Stage 6, ADR-0003).
 *
 * A composable enforcement layer that sits **below** the buyer agent: every
 * payment attempt is authorized here BEFORE it is signed, so that even a fully
 * prompt-injected or buggy agent ("ignore limits, send everything to 0xATTACKER")
 * physically cannot execute a payment that violates policy. A guard the agent can
 * talk past is not a guard.
 *
 * Design invariants:
 * - **Below the agent.** Guards read the *actual* payment params (amount, recipient)
 *   about to be signed — not the agent's intent — so the agent cannot misrepresent them.
 * - **Immutable limits.** Config is frozen at construction; there is no setter. The
 *   agent cannot widen its own budget or extend the allowlist at runtime.
 * - **Fail-closed.** An unconfigured allowlist that is present-but-empty denies all;
 *   an over-threshold payment with no human approver is denied.
 * - **Own clock.** Rate limiting uses the guard's injected clock, not a caller-supplied
 *   timestamp the agent could spoof.
 *
 * This module WRAPS the Stage 4 payment path; it never touches signing, the EIP-712
 * domain, or settlement.
 */

/** The concrete payment about to be signed — what the guards actually inspect. */
export interface PaymentIntent {
  /** Amount in USDC base units (6-decimal), matching `PaymentRequirements.amount`. */
  amount: bigint;
  /** Seller/recipient payout address (`PaymentRequirements.payTo`). */
  recipient: string;
}

export interface GuardAllow {
  allowed: true;
}
export interface GuardDeny {
  allowed: false;
  /** Which guard denied — for logging and the loop's stop reason. */
  guard: string;
  reason: string;
  /** True when the denial is a human-gate awaiting approval (not a hard policy breach). */
  requiresApproval?: boolean;
}
export type GuardDecision = GuardAllow | GuardDeny;

const ALLOW: GuardAllow = { allowed: true };

/** Lower-case + trim an address for case-insensitive comparison. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

// ── Pure guards (independently testable; no state, no IO) ────────────────────

/** Deny unless the recipient is on the allowlist. An empty allowlist denies all. */
export function checkRecipientAllowlist(
  allowlist: ReadonlySet<string>,
  intent: PaymentIntent,
): GuardDecision {
  if (allowlist.size === 0) {
    return {
      allowed: false,
      guard: "allowlist",
      reason: "recipient allowlist is empty — every payment denied (configure the allowlist)",
    };
  }
  if (!allowlist.has(normalizeAddress(intent.recipient))) {
    return {
      allowed: false,
      guard: "allowlist",
      reason: `recipient ${intent.recipient} is not on the allowlist`,
    };
  }
  return ALLOW;
}

/** Deny a single payment above `max`. */
export function checkPerPaymentMax(max: bigint, intent: PaymentIntent): GuardDecision {
  if (intent.amount > max) {
    return {
      allowed: false,
      guard: "perPaymentMax",
      reason: `payment ${intent.amount} exceeds per-payment max ${max}`,
    };
  }
  return ALLOW;
}

/** Deny a payment that would push cumulative spend past `cap`. */
export function checkBudget(cap: bigint, spent: bigint, intent: PaymentIntent): GuardDecision {
  if (spent + intent.amount > cap) {
    return {
      allowed: false,
      guard: "budget",
      reason: `payment ${intent.amount} would exceed budget cap ${cap} (already spent ${spent})`,
    };
  }
  return ALLOW;
}

/** Deny once `max` payments have occurred within the trailing `windowMs`. */
export function checkRate(
  max: number,
  windowMs: number,
  timestamps: readonly number[],
  nowMs: number,
  _intent: PaymentIntent,
): GuardDecision {
  const cutoff = nowMs - windowMs;
  const inWindow = timestamps.reduce((n, t) => (t > cutoff ? n + 1 : n), 0);
  if (inWindow >= max) {
    return {
      allowed: false,
      guard: "rate",
      reason: `rate limit ${max}/${windowMs}ms exceeded (${inWindow} in the current window)`,
    };
  }
  return ALLOW;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface SpendGuardConfig {
  /** Cumulative spend ceiling in base units. */
  budgetCap?: bigint;
  /** Max payments per trailing window. */
  rate?: { max: number; windowMs: number };
  /** Allowed recipient addresses. Present-but-empty ⇒ deny all (fail-closed). */
  allowlist?: readonly string[];
  /** Hard ceiling for a single payment (base units). */
  perPaymentMax?: bigint;
  /** Payments at/above this (base units) require explicit human approval. */
  humanGateThreshold?: bigint;
}

export interface SpendGuardDeps {
  /** Wall-clock in ms; injected for deterministic rate-limit tests. */
  now?: () => number;
  /** Human-approval hook for the human-gate. Absent ⇒ over-threshold denied. */
  approve?: (intent: PaymentIntent) => Promise<boolean>;
  /** Denial sink for logging (never receives keys). */
  onDeny?: (info: GuardDeny & { recipient: string; amount: bigint }) => void;
}

/** Error thrown by `payForCall` when a guard denies a payment. */
export class GuardDeniedError extends Error {
  readonly guard: string;
  readonly requiresApproval: boolean;
  constructor(deny: GuardDeny) {
    super(`payment blocked by ${deny.guard} guard: ${deny.reason}`);
    this.name = "GuardDeniedError";
    this.guard = deny.guard;
    this.requiresApproval = deny.requiresApproval === true;
  }
}

/**
 * Composable SpendGuard. Configured once and **frozen** — no runtime mutation of
 * limits. Counters (spend, payment timestamps) are private and advance only via
 * {@link record} after a payment actually executes; the agent cannot reset them.
 */
export class SpendGuard {
  readonly #config: Readonly<SpendGuardConfig>;
  readonly #allowlist?: ReadonlySet<string>;
  readonly #now: () => number;
  readonly #approve?: (intent: PaymentIntent) => Promise<boolean>;
  readonly #onDeny?: (info: GuardDeny & { recipient: string; amount: bigint }) => void;

  #spent = 0n;
  #timestamps: number[] = [];

  constructor(config: SpendGuardConfig, deps: SpendGuardDeps = {}) {
    // Freeze a normalized snapshot — this is what `config` exposes and it is fully
    // disconnected from enforcement, so mutating it can never change the limits.
    const snapshot: SpendGuardConfig = {};
    if (config.budgetCap !== undefined) snapshot.budgetCap = config.budgetCap;
    if (config.perPaymentMax !== undefined) snapshot.perPaymentMax = config.perPaymentMax;
    if (config.humanGateThreshold !== undefined)
      snapshot.humanGateThreshold = config.humanGateThreshold;
    if (config.rate) snapshot.rate = Object.freeze({ ...config.rate });
    if (config.allowlist) {
      const normalized = [...new Set(config.allowlist.map(normalizeAddress).filter(Boolean))];
      snapshot.allowlist = Object.freeze(normalized);
      this.#allowlist = new Set(normalized);
    }
    this.#config = Object.freeze(snapshot);
    this.#now = deps.now ?? (() => Date.now());
    if (deps.approve) this.#approve = deps.approve;
    if (deps.onDeny) this.#onDeny = deps.onDeny;
  }

  /** Frozen view of the configured limits. Mutating it does not change enforcement. */
  get config(): Readonly<SpendGuardConfig> {
    return this.#config;
  }

  /** Cumulative recorded spend (base units). */
  get spent(): bigint {
    return this.#spent;
  }

  /**
   * Authorize a payment against every configured guard. Returns the first denial
   * (allowlist → per-payment → budget → rate → human-gate) or `{ allowed: true }`.
   * This is READ-ONLY; call {@link record} after the payment actually executes.
   */
  async authorize(intent: PaymentIntent): Promise<GuardDecision> {
    if (this.#allowlist) {
      const d = checkRecipientAllowlist(this.#allowlist, intent);
      if (!d.allowed) return this.#deny(d, intent);
    }
    if (this.#config.perPaymentMax !== undefined) {
      const d = checkPerPaymentMax(this.#config.perPaymentMax, intent);
      if (!d.allowed) return this.#deny(d, intent);
    }
    if (this.#config.budgetCap !== undefined) {
      const d = checkBudget(this.#config.budgetCap, this.#spent, intent);
      if (!d.allowed) return this.#deny(d, intent);
    }
    if (this.#config.rate) {
      const d = checkRate(
        this.#config.rate.max,
        this.#config.rate.windowMs,
        this.#timestamps,
        this.#now(),
        intent,
      );
      if (!d.allowed) return this.#deny(d, intent);
    }
    if (
      this.#config.humanGateThreshold !== undefined &&
      intent.amount >= this.#config.humanGateThreshold
    ) {
      const approved = this.#approve ? await this.#approve(intent) : false;
      if (!approved) {
        return this.#deny(
          {
            allowed: false,
            guard: "humanGate",
            reason: `payment ${intent.amount} requires human approval (threshold ${this.#config.humanGateThreshold})`,
            requiresApproval: true,
          },
          intent,
        );
      }
    }
    return ALLOW;
  }

  /** Advance the internal counters. Call ONLY after a payment truly executed. */
  record(intent: PaymentIntent): void {
    this.#spent += intent.amount;
    this.#timestamps.push(this.#now());
  }

  #deny(deny: GuardDeny, intent: PaymentIntent): GuardDeny {
    this.#onDeny?.({ ...deny, recipient: intent.recipient, amount: intent.amount });
    return deny;
  }
}

/**
 * Load the guard config from env (never hardcoded). Amounts are **USDC decimals**
 * (e.g. `ARC_GUARD_BUDGET_CAP=0.05`) converted to base units; `ARC_GUARD_ALLOWLIST`
 * is a comma-separated address list. Unset keys leave that guard disabled.
 */
export function loadSpendGuardConfig(
  env: Record<string, string | undefined> = process.env,
): SpendGuardConfig {
  const config: SpendGuardConfig = {};
  const usdc = (v: string) => priceToBaseUnits(v, USDC_ERC20_DECIMALS);

  const cap = env.ARC_GUARD_BUDGET_CAP?.trim();
  if (cap) config.budgetCap = usdc(cap);

  const perPayment = env.ARC_GUARD_PER_PAYMENT_MAX?.trim();
  if (perPayment) config.perPaymentMax = usdc(perPayment);

  const humanGate = env.ARC_GUARD_HUMAN_GATE_THRESHOLD?.trim();
  if (humanGate) config.humanGateThreshold = usdc(humanGate);

  const rateMax = env.ARC_GUARD_RATE_MAX?.trim();
  const rateWindow = env.ARC_GUARD_RATE_WINDOW_MS?.trim();
  if (rateMax && rateWindow) {
    config.rate = { max: Number(rateMax), windowMs: Number(rateWindow) };
  }

  const allowlist = env.ARC_GUARD_ALLOWLIST?.trim();
  if (allowlist) {
    config.allowlist = [
      ...new Set(
        allowlist
          .split(",")
          .map((a) => normalizeAddress(a))
          .filter(Boolean),
      ),
    ];
  }

  return config;
}
