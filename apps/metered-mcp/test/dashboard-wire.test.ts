import { InMemorySettlementQueue } from "arcpayments";
import { describe, expect, it } from "vitest";
import { buildSellerState } from "../src/dashboard/wire";

const SELLER = "0xda6b000000000000000000000000000000000001";
const ATTACKER = "0x00000000000000000000000000000000dead0002";

describe("buildSellerState — real guard wiring", () => {
  it("surfaces the guard config and routes denials into the safety panel", async () => {
    const { state, guard } = buildSellerState({
      env: {
        SELLER_ADDRESS: SELLER,
        ARC_GUARD_ALLOWLIST: SELLER,
        ARC_GUARD_BUDGET_CAP: "0.05",
      },
      queue: new InMemorySettlementQueue(),
    });
    expect(guard).toBeDefined();

    // a blocked payment (prompt-injection to an unlisted recipient) flows to the panel
    const decision = await guard?.authorize({ amount: 1000n, recipient: ATTACKER });
    expect(decision?.allowed).toBe(false);

    const model = await state.model();
    expect(model.safety.configured).toBe(true);
    expect(model.safety.budget?.cap).toBe("0.05");
    expect(model.safety.denials).toHaveLength(1);
    expect(model.safety.denials[0]).toMatchObject({
      guard: "allowlist",
      payerShort: "0x0000…0002",
    });
  });

  it("has no guard and an unavailable balance when nothing is configured (honest)", async () => {
    const { state, guard } = buildSellerState({
      env: { SELLER_ADDRESS: SELLER },
      queue: new InMemorySettlementQueue(),
    });
    expect(guard).toBeUndefined();
    const model = await state.model();
    expect(model.safety.configured).toBe(false);
    expect(model.balance.state).toBe("unavailable"); // no SELLER_PRIVATE_KEY → no reader
    expect(model.seller.addressShort?.toLowerCase()).toBe("0xda6b…0001");
  });
});
