import { describe, expect, it, vi } from "vitest";
import { type SellerCashoutOptions, runSellerCashout } from "../src/cashout";
import type { CctpBridge } from "../src/cctp";
import type { GatewayWithdrawer, WithdrawResult } from "../src/withdraw";

const HASH = `0x${"a".repeat(64)}` as const;
const BURN = `0x${"b".repeat(64)}` as const;
const MINT = `0x${"c".repeat(64)}` as const;

/** A withdrawer whose available balance is `available` (default 20). */
function withdrawerWith(available: string) {
  const availableFormatted = vi.fn(async () => available);
  const withdraw = vi.fn(
    async (amount: string): Promise<WithdrawResult> => ({
      mintTxHash: HASH,
      amount: (Number(amount) * 1_000_000).toString(),
      formattedAmount: amount,
      sourceChain: "arcTestnet",
      destinationChain: "arcTestnet",
      recipient: "0x00000000000000000000000000000000000000A1",
    }),
  );
  const withdrawer: GatewayWithdrawer = { availableFormatted, withdraw };
  return { withdrawer, availableFormatted, withdraw };
}

function successBridge(): CctpBridge {
  return {
    bridge: async () => ({
      state: "success",
      steps: [
        { name: "Burn", state: "success", txHash: BURN },
        { name: "Mint", state: "success", txHash: MINT },
      ],
    }),
  };
}

function base(over: Partial<SellerCashoutOptions> = {}): SellerCashoutOptions {
  return {
    withdrawer: withdrawerWith("20").withdrawer,
    explorerUrl: "https://testnet.arcscan.app",
    caip2: "eip155:5042002",
    cctp: false,
    write: () => {},
    writeErr: () => {},
    ...over,
  };
}

describe("runSellerCashout — guards protect the irreversible burn", () => {
  it("CCTP=1 without WITHDRAW_AMOUNT is an error — refuses BEFORE any withdraw or burn", async () => {
    const { withdrawer, availableFormatted, withdraw } = withdrawerWith("20");
    const makeBridge = vi.fn(successBridge);
    // withdrawAmount deliberately omitted
    const res = await runSellerCashout(
      base({ cctp: true, cctpAmount: "5", withdrawer, makeBridge }),
    );
    expect(res.code).not.toBe(0);
    expect(res.burned).toBe(false);
    // did not even read the balance, let alone withdraw or burn
    expect(availableFormatted).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
    expect(makeBridge).not.toHaveBeenCalled();
  });

  it("leg 1 failure halts with a non-zero exit and NEVER burns", async () => {
    // available = 0 → runGatewayWithdraw returns ok:false (nothing withdrawable)
    const { withdrawer } = withdrawerWith("0");
    const makeBridge = vi.fn(successBridge);
    const res = await runSellerCashout(
      base({ cctp: true, cctpAmount: "5", withdrawAmount: "14", withdrawer, makeBridge }),
    );
    expect(res.code).not.toBe(0);
    expect(res.burned).toBe(false);
    expect(makeBridge).not.toHaveBeenCalled(); // bridge never even constructed
  });

  it("CCTP=1 without CCTP_AMOUNT is an error — refuses before any withdraw", async () => {
    const { withdrawer, availableFormatted } = withdrawerWith("20");
    // cctpAmount deliberately omitted
    const res = await runSellerCashout(base({ cctp: true, withdrawAmount: "14", withdrawer }));
    expect(res.code).not.toBe(0);
    expect(availableFormatted).not.toHaveBeenCalled();
  });
});

describe("runSellerCashout — happy paths unchanged", () => {
  it("withdraw + burn: leg 1 succeeds → burns and exits 0", async () => {
    const makeBridge = vi.fn(successBridge);
    const res = await runSellerCashout(
      base({ cctp: true, withdrawAmount: "14", cctpAmount: "5", makeBridge }),
    );
    expect(res.code).toBe(0);
    expect(res.burned).toBe(true);
    expect(makeBridge).toHaveBeenCalledTimes(1);
  });

  it("withdraw-only (CCTP off): succeeds, exits 0, never constructs a bridge", async () => {
    const makeBridge = vi.fn(successBridge);
    const res = await runSellerCashout(base({ cctp: false, makeBridge }));
    expect(res.code).toBe(0);
    expect(res.burned).toBe(false);
    expect(makeBridge).not.toHaveBeenCalled();
  });

  it("withdraw-only leg 1 failure still exits non-zero", async () => {
    const { withdrawer } = withdrawerWith("0");
    const res = await runSellerCashout(base({ cctp: false, withdrawer }));
    expect(res.code).not.toBe(0);
    expect(res.burned).toBe(false);
  });
});
