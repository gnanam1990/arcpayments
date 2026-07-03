import { describe, expect, it, vi } from "vitest";
import {
  GuardDeniedError,
  type PaymentIntent,
  SpendGuard,
  checkBudget,
  checkPerPaymentMax,
  checkRate,
  checkRecipientAllowlist,
  loadSpendGuardConfig,
  normalizeAddress,
} from "../src/spend-guard";

const SELLER = "0xda6b000000000000000000000000000000000001";
const ATTACKER = "0x000000000000000000000000000000000000dead";

function intent(amount: bigint, recipient = SELLER): PaymentIntent {
  return { amount, recipient };
}

describe("pure guards", () => {
  it("recipient allowlist: allows a listed address (case-insensitive), denies others, denies when empty", () => {
    const list = new Set([normalizeAddress(SELLER)]);
    expect(checkRecipientAllowlist(list, intent(1000n, SELLER.toUpperCase())).allowed).toBe(true);
    const denied = checkRecipientAllowlist(list, intent(1000n, ATTACKER));
    expect(denied.allowed).toBe(false);
    // fail-closed: an empty allowlist denies everything
    expect(checkRecipientAllowlist(new Set(), intent(1000n, SELLER)).allowed).toBe(false);
  });

  it("per-payment max: allows at/below, denies above", () => {
    expect(checkPerPaymentMax(1000n, intent(1000n)).allowed).toBe(true);
    expect(checkPerPaymentMax(1000n, intent(1001n)).allowed).toBe(false);
  });

  it("budget: denies the payment that would cross the cumulative ceiling", () => {
    expect(checkBudget(5000n, 4000n, intent(1000n)).allowed).toBe(true);
    expect(checkBudget(5000n, 4000n, intent(1001n)).allowed).toBe(false);
  });

  it("rate: denies once the window is full, allows again once it slides", () => {
    const stamps = [0, 100, 200];
    expect(checkRate(3, 1000, stamps, 500, intent(1000n)).allowed).toBe(false); // 3 in [−500,500]
    expect(checkRate(3, 1000, stamps, 1300, intent(1000n)).allowed).toBe(true); // all older than window
  });
});

describe("SpendGuard composite", () => {
  it("requires ALL configured guards to pass (allowlist + budget + per-payment)", async () => {
    const g = new SpendGuard({
      allowlist: [SELLER],
      budgetCap: 5000n,
      perPaymentMax: 2000n,
    });
    expect((await g.authorize(intent(1000n, SELLER))).allowed).toBe(true);
    expect((await g.authorize(intent(1000n, ATTACKER))).allowed).toBe(false); // allowlist
    expect((await g.authorize(intent(3000n, SELLER))).allowed).toBe(false); // per-payment
  });

  it("budget: record() advances spend; cumulative never exceeds the cap", async () => {
    const g = new SpendGuard({ budgetCap: 2500n });
    for (let i = 0; i < 3; i++) {
      const d = await g.authorize(intent(1000n));
      if (d.allowed) g.record(intent(1000n));
    }
    expect(g.spent).toBe(2000n); // third (would be 3000) denied; two recorded
    expect(g.spent).toBeLessThanOrEqual(2500n);
    expect((await g.authorize(intent(1000n))).allowed).toBe(false);
  });

  it("rate: uses the guard's OWN clock (not caller-supplied), denies the burst", async () => {
    let t = 0;
    const g = new SpendGuard({ rate: { max: 2, windowMs: 1000 } }, { now: () => t });
    expect((await g.authorize(intent(1n))).allowed).toBe(true);
    g.record(intent(1n));
    expect((await g.authorize(intent(1n))).allowed).toBe(true);
    g.record(intent(1n));
    expect((await g.authorize(intent(1n))).allowed).toBe(false); // 3rd in window
    t = 1001;
    expect((await g.authorize(intent(1n))).allowed).toBe(true); // window slid
  });

  it("human-gate: over-threshold blocks without approval, proceeds only on explicit approve", async () => {
    const approve = vi.fn(async () => false);
    const g = new SpendGuard({ humanGateThreshold: 1000n }, { approve });
    // below threshold: no approval needed
    expect((await g.authorize(intent(999n))).allowed).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    // at/over threshold: approver says no → denied, flagged requiresApproval
    const denied = await g.authorize(intent(1000n));
    expect(denied.allowed).toBe(false);
    expect(denied.allowed === false && denied.requiresApproval).toBe(true);
    // approver says yes → allowed
    approve.mockResolvedValueOnce(true);
    expect((await g.authorize(intent(5000n))).allowed).toBe(true);
  });

  it("human-gate with NO approver configured blocks over-threshold payments (fail-closed)", async () => {
    const g = new SpendGuard({ humanGateThreshold: 1000n });
    expect((await g.authorize(intent(1000n))).allowed).toBe(false);
  });

  it("calls onDeny with the reason (no keys) and surfaces the failing guard name", async () => {
    const onDeny = vi.fn();
    const g = new SpendGuard({ allowlist: [SELLER] }, { onDeny });
    const d = await g.authorize(intent(1000n, ATTACKER));
    expect(d.allowed === false && d.guard).toBe("allowlist");
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledWith(
      expect.objectContaining({ guard: "allowlist", recipient: ATTACKER, amount: 1000n }),
    );
  });
});

describe("config immutability — the agent cannot rewrite its own limits", () => {
  it("freezes the config; mutation attempts do not change enforced limits", async () => {
    const g = new SpendGuard({ budgetCap: 1000n, allowlist: [SELLER] });
    // attempt to widen the budget / allow the attacker at runtime
    try {
      (g.config as { budgetCap?: bigint }).budgetCap = 10_000_000n;
    } catch {
      /* frozen → throws in strict mode; that's fine */
    }
    try {
      (g.config as { allowlist?: string[] }).allowlist?.push(ATTACKER);
    } catch {
      /* frozen */
    }
    expect(Object.isFrozen(g.config)).toBe(true);
    // enforcement is unchanged: attacker still denied, over-cap still denied
    expect((await g.authorize(intent(1000n, ATTACKER))).allowed).toBe(false);
    expect((await g.authorize(intent(2000n, SELLER))).allowed).toBe(false);
  });
});

describe("GuardDeniedError", () => {
  it("carries the guard name + approval flag and a readable message", () => {
    const err = new GuardDeniedError({
      allowed: false,
      guard: "allowlist",
      reason: "recipient not allowed",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.guard).toBe("allowlist");
    expect(err.message).toMatch(/allowlist/);
  });
});

describe("loadSpendGuardConfig — from env, no hardcoded limits", () => {
  it("parses USDC-decimal envs into base units and a comma-separated allowlist", () => {
    const cfg = loadSpendGuardConfig({
      ARC_GUARD_BUDGET_CAP: "0.05",
      ARC_GUARD_PER_PAYMENT_MAX: "0.01",
      ARC_GUARD_HUMAN_GATE_THRESHOLD: "0.02",
      ARC_GUARD_RATE_MAX: "5",
      ARC_GUARD_RATE_WINDOW_MS: "60000",
      ARC_GUARD_ALLOWLIST: `${SELLER}, ${SELLER.toUpperCase()}`,
    });
    expect(cfg.budgetCap).toBe(50_000n); // 0.05 * 1e6
    expect(cfg.perPaymentMax).toBe(10_000n);
    expect(cfg.humanGateThreshold).toBe(20_000n);
    expect(cfg.rate).toEqual({ max: 5, windowMs: 60_000 });
    expect(cfg.allowlist).toEqual([SELLER]); // normalized + de-duped
  });

  it("returns an empty config when nothing is set (all guards simply disabled)", () => {
    expect(loadSpendGuardConfig({})).toEqual({});
  });
});
