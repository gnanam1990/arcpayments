import { describe, expect, it } from "vitest";
import { run } from "../src/cli";
import { VERSION } from "../src/version";

describe("arcpayments --help", () => {
  it("exits 0 and prints usage including every command", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage");
    expect(result.stdout).toContain("arcpayments");
    expect(result.stdout).toContain("create");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("wallet:new");
    expect(result.stdout).toContain("faucet");
    expect(result.stdout).toContain("gateway:deposit");
    expect(result.stdout).toContain("gateway:balance");
    expect(result.stdout).toContain("gateway:withdraw");
    expect(result.stdout).toContain("cctp:transfer");
    expect(result.stdout).toContain("add paywall");
  });

  it("treats -h and no args the same as --help (exit 0)", async () => {
    expect((await run(["-h"])).code).toBe(0);
    expect((await run([])).code).toBe(0);
    expect((await run([])).stdout).toContain("doctor");
  });
});

describe("arcpayments --version", () => {
  it("prints the package version and exits 0", async () => {
    const result = await run(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });
});

describe("unknown command", () => {
  it("exits non-zero and points at --help", async () => {
    const result = await run(["definitely-not-a-command"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--help");
  });
});

describe("seller cash-out commands gate on SELLER_PRIVATE_KEY (no network without it)", () => {
  it("gateway:withdraw refuses without SELLER_PRIVATE_KEY", async () => {
    const result = await run(["gateway:withdraw"], {});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("SELLER_PRIVATE_KEY");
  });

  it("cctp:transfer requires an amount", async () => {
    const result = await run(["cctp:transfer", "--to", "base-sepolia"], {
      SELLER_PRIVATE_KEY: "0xabc",
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("requires an <amount>");
  });

  it("cctp:transfer refuses without SELLER_PRIVATE_KEY", async () => {
    const result = await run(["cctp:transfer", "0.5", "--to", "base-sepolia"], {});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("SELLER_PRIVATE_KEY");
  });
});
