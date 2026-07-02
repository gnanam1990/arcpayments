import { describe, expect, it } from "vitest";
import {
  type SettlementResolver,
  type TransferInfo,
  extractTxHash,
  isOnChainTxHash,
  resolveSettlementTxHash,
} from "../src/gateway-settlement";

const HASH = `0x${"a".repeat(64)}` as const;
const BLOCK = `0x${"b".repeat(64)}` as const;

describe("isOnChainTxHash", () => {
  it("accepts a 32-byte 0x hash and rejects a UUID / short string", () => {
    expect(isOnChainTxHash(HASH)).toBe(true);
    expect(isOnChainTxHash("b1b2c3d4-1234-5678-9abc-def012345678")).toBe(false);
    expect(isOnChainTxHash("0x1234")).toBe(false);
    expect(isOnChainTxHash(undefined)).toBe(false);
  });
});

describe("extractTxHash — pull a real on-chain hash from the raw transfer response", () => {
  it("prefers a known transaction-hash key", () => {
    expect(extractTxHash({ transactionHash: HASH, blockHash: BLOCK })).toBe(HASH);
    expect(extractTxHash({ txHash: HASH })).toBe(HASH);
  });

  it("does NOT return the settlement/transfer UUID", () => {
    expect(
      extractTxHash({ id: "b1b2c3d4-1234-5678-9abc-def012345678", status: "batched" }),
    ).toBeUndefined();
  });

  it("finds a hash one level deep, but never a blockHash", () => {
    expect(extractTxHash({ settlement: { transactionHash: HASH } })).toBe(HASH);
    // only a blockHash present → no tx hash returned (avoid false positives)
    expect(extractTxHash({ blockHash: BLOCK })).toBeUndefined();
  });

  it("returns undefined when no hash is present", () => {
    expect(extractTxHash({ status: "batched" })).toBeUndefined();
  });
});

function scriptedResolver(sequence: TransferInfo[]): {
  resolver: SettlementResolver;
  calls: () => number;
} {
  let i = 0;
  return {
    resolver: {
      getTransfer: async (id) => {
        const info = sequence[Math.min(i, sequence.length - 1)] as TransferInfo;
        i += 1;
        return { ...info, id };
      },
    },
    calls: () => i,
  };
}

const noSleep = async () => {};

describe("resolveSettlementTxHash — poll a settlement UUID to its on-chain hash", () => {
  it("polls until the transfer is completed with a tx hash", async () => {
    const { resolver, calls } = scriptedResolver([
      { id: "u", status: "received", raw: {} },
      { id: "u", status: "batched", raw: {} },
      { id: "u", status: "completed", txHash: HASH, raw: { transactionHash: HASH } },
    ]);
    const info = await resolveSettlementTxHash(resolver, "u", { attempts: 5, sleep: noSleep });
    expect(info.txHash).toBe(HASH);
    expect(info.status).toBe("completed");
    expect(calls()).toBe(3);
  });

  it("stops immediately on a failed transfer", async () => {
    const { resolver, calls } = scriptedResolver([{ id: "u", status: "failed", raw: {} }]);
    const info = await resolveSettlementTxHash(resolver, "u", { attempts: 5, sleep: noSleep });
    expect(info.status).toBe("failed");
    expect(info.txHash).toBeUndefined();
    expect(calls()).toBe(1);
  });

  it("gives up after `attempts` and returns the last status without a fake hash", async () => {
    const { resolver, calls } = scriptedResolver([{ id: "u", status: "batched", raw: {} }]);
    const info = await resolveSettlementTxHash(resolver, "u", { attempts: 3, sleep: noSleep });
    expect(info.txHash).toBeUndefined();
    expect(info.status).toBe("batched");
    expect(calls()).toBe(3);
  });
});
