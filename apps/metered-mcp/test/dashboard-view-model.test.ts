import type { GatewayBalanceReport, SettlementRecord, SpendGuardSnapshot } from "arcpayments";
import { describe, expect, it } from "vitest";
import {
  type DashboardInput,
  type DenialRecord,
  buildDashboardModel,
  truncateAddress,
} from "../src/dashboard/view-model";

const PAYER = "0x824c000000000000000000000000000000009f1a";
const SELLER = "0xda6b000000000000000000000000000000000001";

function rec(over: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    id: "id-1",
    payer: PAYER,
    amount: "1000", // 0.001 USDC in 6-dec base units
    network: "eip155:5042002",
    status: "settled",
    enqueuedAt: 1_700_000_000_000,
    payment: {} as SettlementRecord["payment"],
    requirements: {} as SettlementRecord["requirements"],
    ...over,
  } as SettlementRecord;
}

function baseInput(over: Partial<DashboardInput> = {}): DashboardInput {
  return {
    seller: { address: SELLER, network: "Arc testnet", price: "$0.001" },
    records: [],
    now: 1_700_000_000_500,
    ...over,
  };
}

describe("truncateAddress", () => {
  it("keeps the 0x, 4 leading + 4 trailing hex, and an ellipsis", () => {
    expect(truncateAddress(PAYER)).toBe("0x824c…9f1a");
    expect(truncateAddress(null)).toBe("—");
  });
});

describe("feed — honest status mapping (Stage 4 vocabulary)", () => {
  it("maps queued→queued, settled→accepted, failed→failed with 6-decimal amounts", () => {
    const model = buildDashboardModel(
      baseInput({
        records: [
          rec({ id: "a", status: "queued" }),
          rec({ id: "b", status: "settled" }),
          rec({ id: "c", status: "failed", error: "insufficient balance" }),
        ],
      }),
    );
    const byId = Object.fromEntries(model.feed.map((r) => [r.id, r]));
    expect(byId.a?.status).toBe("queued");
    expect(byId.b?.status).toBe("accepted"); // Gateway ACCEPTED ≠ on-chain completed
    expect(byId.c?.status).toBe("failed");
    expect(byId.c?.error).toBe("insufficient balance");
    expect(byId.b?.amount).toBe("0.001"); // formatted from "1000" base units
    expect(byId.b?.payerShort).toBe("0x824c…9f1a");
  });

  it("newest first", () => {
    const model = buildDashboardModel(
      baseInput({
        records: [rec({ id: "old", enqueuedAt: 1000 }), rec({ id: "new", enqueuedAt: 2000 })],
      }),
    );
    expect(model.feed.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("NEVER fakes a tx link: a non-0x settlement id is shown as an ID, not linked", () => {
    const model = buildDashboardModel(
      baseInput({
        records: [rec({ status: "settled", transaction: "b1b0f0e2-uuid-not-a-hash" })],
      }),
    );
    const row = model.feed[0];
    expect(row?.txHash).toBeUndefined(); // not a real 0x hash → no explorer link
    expect(row?.settlementId).toBe("b1b0f0e2-uuid-not-a-hash");
  });

  it("links the explorer ONLY for a real 0x on-chain hash", () => {
    const hash = `0x${"a".repeat(64)}`;
    const model = buildDashboardModel(
      baseInput({ records: [rec({ status: "settled", transaction: hash })] }),
    );
    expect(model.feed[0]?.txHash).toBe(hash);
  });

  it("marks a record completed only when a real on-chain completion is supplied", () => {
    const model = buildDashboardModel(
      baseInput({
        records: [rec({ id: "done", status: "settled" })],
        completedIds: new Set(["done"]),
      }),
    );
    expect(model.feed[0]?.status).toBe("completed");
  });
});

describe("settlement summary — accepted vs completed kept distinct", () => {
  it("counts states and sums earned from accepted records only", () => {
    const model = buildDashboardModel(
      baseInput({
        records: [
          rec({ id: "a", status: "settled", amount: "1000" }),
          rec({ id: "b", status: "settled", amount: "1000" }),
          rec({ id: "c", status: "queued", amount: "1000" }),
          rec({ id: "d", status: "failed", amount: "1000" }),
        ],
      }),
    );
    expect(model.settlement.accepted).toBe(2);
    expect(model.settlement.queued).toBe(1);
    expect(model.settlement.failed).toBe(1);
    expect(model.settlement.completed).toBe(0); // none confirmed on-chain
    expect(model.settlement.earned).toBe("0.002"); // 2 × $0.001 accepted
    expect(model.settlement.note.toLowerCase()).toContain("10 min"); // honest cadence
  });
});

describe("balance card — reuses gateway:balance output, honest when unavailable", () => {
  it("renders formatted balances when the read succeeded", () => {
    const report: GatewayBalanceReport = {
      ok: true,
      balances: {
        address: SELLER,
        walletFormatted: "10",
        gatewayTotalFormatted: "0.003",
        gatewayAvailableFormatted: "0.003",
        gatewayWithdrawingFormatted: "0",
        gatewayWithdrawableFormatted: "0",
      },
    };
    const card = buildDashboardModel(baseInput({ balance: report })).balance;
    expect(card.state).toBe("ok");
    expect(card.available).toBe("0.003");
    expect(card.deposited).toBe("0.003");
    expect(card.addressShort).toBe("0xda6b…0001");
  });

  it("is honestly unavailable (not zero) when no reader is configured", () => {
    const card = buildDashboardModel(baseInput()).balance; // balance omitted ⇒ no reader
    expect(card.state).toBe("unavailable");
    expect(card.available).toBeNull();
    expect(card.error?.toLowerCase()).toContain("seller key");
  });

  it("surfaces a failed read reason", () => {
    const card = buildDashboardModel(
      baseInput({ balance: { ok: false, error: "network unreachable" } }),
    ).balance;
    expect(card.state).toBe("unavailable");
    expect(card.error).toContain("network unreachable");
  });
});

describe("safety panel — surfaces the Stage 6 guard state", () => {
  it("maps a guard snapshot + denials into the panel", () => {
    const snapshot: SpendGuardSnapshot = {
      spent: 3000n,
      budgetCap: 50_000n,
      perPaymentMax: 10_000n,
      rate: { max: 5, windowMs: 60_000, used: 3, headroom: 2 },
      allowlist: [SELLER],
    };
    const denials: DenialRecord[] = [
      {
        guard: "allowlist",
        reason: "recipient not allowed",
        recipient: PAYER,
        amount: 1000n,
        at: 1,
      },
    ];
    const panel = buildDashboardModel(baseInput({ guard: snapshot, denials })).safety;
    expect(panel.configured).toBe(true);
    expect(panel.budget).toMatchObject({ used: "0.003", cap: "0.05", pct: 6 });
    expect(panel.rate).toMatchObject({ used: 3, max: 5, headroom: 2 });
    expect(panel.allowlistSize).toBe(1);
    expect(panel.allowlist[0]).toBe("0xda6b…0001");
    expect(panel.denials[0]).toMatchObject({ guard: "allowlist", payerShort: "0x824c…9f1a" });
  });

  it("is honestly 'not configured' when no guard is present", () => {
    const panel = buildDashboardModel(baseInput()).safety; // guard omitted ⇒ not configured
    expect(panel.configured).toBe(false);
    expect(panel.allowlistSize).toBe(0);
    expect(panel.denials).toEqual([]);
  });
});

describe("seller header", () => {
  it("truncates the seller address and carries network + price", () => {
    const model = buildDashboardModel(baseInput());
    expect(model.seller.addressShort).toBe("0xda6b…0001");
    expect(model.seller.network).toBe("Arc testnet");
    expect(model.seller.price).toBe("$0.001");
    expect(model.generatedAt).toBe(1_700_000_000_500);
  });
});
