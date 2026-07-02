import { describe, expect, it } from "vitest";
import { type DoctorDeps, formatDoctorReport, runDoctor } from "../src/doctor";
import { ARC_TESTNET_DEFAULTS } from "../src/network";

function baseDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    config: ARC_TESTNET_DEFAULTS,
    runtime: { name: "node", version: "v20.11.0" },
    getRemoteChainId: async () => ARC_TESTNET_DEFAULTS.chainId,
    hasWallet: false,
    ...overrides,
  };
}

describe("runDoctor", () => {
  it("passes (ok=true) when the RPC returns the configured chain ID", async () => {
    const report = await runDoctor(baseDeps());
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "Chain ID match")?.status).toBe("pass");
    expect(report.checks.find((c) => c.name === "RPC reachable")?.status).toBe("pass");
  });

  it("fails (ok=false) when the RPC returns a mismatched chain ID", async () => {
    const report = await runDoctor(
      baseDeps({ getRemoteChainId: async () => ARC_TESTNET_DEFAULTS.chainId + 1 }),
    );
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "Chain ID match")?.status).toBe("fail");
  });

  it("fails when the RPC is unreachable (getRemoteChainId throws)", async () => {
    const report = await runDoctor(
      baseDeps({
        getRemoteChainId: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "RPC reachable")?.status).toBe("fail");
  });

  it("treats a missing wallet as a non-fatal warning (fine for Stage 1)", async () => {
    const report = await runDoctor(baseDeps({ hasWallet: false }));
    const wallet = report.checks.find((c) => c.name === "Wallet");
    expect(wallet?.status).toBe("warn");
    expect(report.ok).toBe(true);
    expect(wallet?.detail.toLowerCase()).toContain("stage 1");
  });

  it("passes the wallet check when a wallet is present", async () => {
    const report = await runDoctor(baseDeps({ hasWallet: true }));
    expect(report.checks.find((c) => c.name === "Wallet")?.status).toBe("pass");
  });

  it("fails when the Node runtime is below the minimum major version", async () => {
    const report = await runDoctor(
      baseDeps({ runtime: { name: "node", version: "v18.19.0" }, minNodeMajor: 20 }),
    );
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "Runtime")?.status).toBe("fail");
  });
});

describe("formatDoctorReport", () => {
  it("renders a readable checklist with every check name", async () => {
    const report = await runDoctor(baseDeps());
    const text = formatDoctorReport(report);
    for (const name of ["Runtime", "RPC reachable", "Chain ID match", "Wallet"]) {
      expect(text).toContain(name);
    }
  });
});
