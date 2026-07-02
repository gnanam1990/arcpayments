import { describe, expect, it } from "vitest";
import {
  type CctpBridge,
  type CctpBridgeResult,
  formatCctpReport,
  runCctpTransfer,
} from "../src/cctp";

const BURN = `0x${"b".repeat(64)}` as const;
const MINT = `0x${"c".repeat(64)}` as const;

function bridge(result: CctpBridgeResult, extra: Partial<CctpBridge> = {}): CctpBridge {
  return { bridge: async () => result, ...extra };
}

const success: CctpBridgeResult = {
  state: "success",
  steps: [
    { name: "Approve", state: "success", txHash: `0x${"1".repeat(64)}` },
    {
      name: "Burn",
      state: "success",
      txHash: BURN,
      explorerUrl: `https://testnet.arcscan.app/tx/${BURN}`,
    },
    {
      name: "Mint",
      state: "success",
      txHash: MINT,
      explorerUrl: `https://sepolia.basescan.org/tx/${MINT}`,
    },
  ],
};

describe("runCctpTransfer", () => {
  it("surfaces burn (source) and mint (dest) hashes, in order, on success", async () => {
    const report = await runCctpTransfer(bridge(success), {
      amount: "0.01",
      toChain: "Base_Sepolia",
    });
    expect(report.ok).toBe(true);
    expect(report.burn?.txHash).toBe(BURN);
    expect(report.mint?.txHash).toBe(MINT);
    // burn step comes before mint step in the ordered list
    const names = report.steps.map((s) => s.name);
    expect(names.indexOf("Burn")).toBeLessThan(names.indexOf("Mint"));
  });

  it("rejects a malformed amount or bad recipient WITHOUT calling the bridge", async () => {
    let called = false;
    const b = bridge(success, {
      bridge: async () => {
        called = true;
        return success;
      },
    });
    expect((await runCctpTransfer(b, { amount: "abc", toChain: "Base_Sepolia" })).ok).toBe(false);
    expect(
      (await runCctpTransfer(b, { amount: "0.01", toChain: "Base_Sepolia", recipient: "nope" })).ok,
    ).toBe(false);
    expect(called).toBe(false);
  });

  it("surfaces a bridge error (not swallowed) and reports NO mint when the burn failed", async () => {
    const failed: CctpBridgeResult = {
      state: "error",
      error: "burn reverted: insufficient USDC",
      steps: [{ name: "Burn", state: "error" }],
    };
    const report = await runCctpTransfer(bridge(failed), {
      amount: "0.01",
      toChain: "Base_Sepolia",
    });
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/burn reverted/i);
    expect(report.mint).toBeUndefined(); // failed burn does not proceed to mint
  });

  it("only builds a hash ref from a real 0x hash (a placeholder step yields none)", async () => {
    const weird: CctpBridgeResult = {
      state: "success",
      steps: [
        { name: "Burn", state: "success", txHash: "pending-uuid" },
        { name: "Mint", state: "success", txHash: MINT },
      ],
    };
    const report = await runCctpTransfer(bridge(weird), {
      amount: "0.01",
      toChain: "Base_Sepolia",
    });
    expect(report.burn).toBeUndefined(); // "pending-uuid" is not a 0x hash
    expect(report.mint?.txHash).toBe(MINT);
  });

  it("polls a pending transfer with backoff until it resolves", async () => {
    let calls = 0;
    const pending: CctpBridgeResult = { state: "pending", steps: [], ref: "xfer-1" };
    const b: CctpBridge = {
      bridge: async () => pending,
      status: async () => {
        calls += 1;
        return calls >= 2 ? success : pending;
      },
    };
    const report = await runCctpTransfer(
      b,
      { amount: "0.01", toChain: "Base_Sepolia" },
      { poll: { sleep: async () => {} } },
    );
    expect(report.ok).toBe(true);
    expect(report.mint?.txHash).toBe(MINT);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("times out cleanly when a pending transfer never completes", async () => {
    const pending: CctpBridgeResult = { state: "pending", steps: [], ref: "xfer-2" };
    const b: CctpBridge = { bridge: async () => pending, status: async () => pending };
    const report = await runCctpTransfer(
      b,
      { amount: "0.01", toChain: "Base_Sepolia" },
      { poll: { maxAttempts: 3, sleep: async () => {} } },
    );
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/pending|timed out/i);
  });
});

describe("formatCctpReport — links only from real hashes", () => {
  it("prints both burn and mint links on success", async () => {
    const report = await runCctpTransfer(bridge(success), {
      amount: "0.01",
      toChain: "Base_Sepolia",
    });
    const text = formatCctpReport(report);
    expect(text).toContain(BURN);
    expect(text).toContain(MINT);
    expect(text.toLowerCase()).toContain("burn");
    expect(text.toLowerCase()).toContain("mint");
  });

  it("renders failure without a mint link", async () => {
    const text = formatCctpReport({
      ok: false,
      state: "error",
      amount: "0.01",
      toChain: "Base_Sepolia",
      error: "boom",
      steps: [],
    });
    expect(text.toLowerCase()).toContain("failed");
    expect(text).toContain("boom");
  });
});
