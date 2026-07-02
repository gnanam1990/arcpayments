import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  LocalWallet,
  WALLET_ENV_KEYS,
  type WalletNewDeps,
  formatWalletNewResult,
  redactSecret,
  runWalletNew,
} from "../src/wallet";

// A fixed, well-known test key (NOT a real funded account) so tests are deterministic.
const TEST_KEY_A = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const TEST_KEY_B = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as const;

function makeDeps(overrides: Partial<WalletNewDeps> = {}): {
  deps: WalletNewDeps;
  writes: Array<{ path: string; contents: string }>;
} {
  const writes: Array<{ path: string; contents: string }> = [];
  const keys = [TEST_KEY_A, TEST_KEY_B];
  let i = 0;
  const deps: WalletNewDeps = {
    envPath: "/tmp/does-not-matter/.env",
    force: false,
    generatePrivateKey: () => keys[i++ % keys.length] as `0x${string}`,
    readEnvFile: () => null,
    writeEnvFile: (path, contents) => writes.push({ path, contents }),
    isEnvGitIgnored: () => true,
    ...overrides,
  };
  return { deps, writes };
}

describe("LocalWallet (the Wallet seam)", () => {
  it("derives the same address viem derives from the private key", () => {
    const wallet = LocalWallet.fromPrivateKey(TEST_KEY_A);
    expect(wallet.getAddress()).toBe(privateKeyToAccount(TEST_KEY_A).address);
    expect(wallet.getAccount().address).toBe(wallet.getAddress());
  });

  it("generate() produces a usable keypair", () => {
    const { wallet, privateKey } = LocalWallet.generate();
    expect(privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(wallet.getAddress()).toBe(privateKeyToAccount(privateKey).address);
  });
});

describe("redactSecret", () => {
  it("reveals at most the last 4 characters and never the whole secret", () => {
    const redacted = redactSecret(TEST_KEY_A);
    expect(redacted).toContain(TEST_KEY_A.slice(-4));
    expect(redacted).not.toContain(TEST_KEY_A);
    expect(redacted.length).toBeLessThan(12);
  });
});

describe("runWalletNew", () => {
  it("aborts (ok=false) when .env is NOT gitignored — never writes keys", () => {
    const { deps, writes } = makeDeps({ isEnvGitIgnored: () => false });
    const result = runWalletNew(deps);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/gitignore/i);
    expect(writes).toHaveLength(0);
  });

  it("creates buyer + seller keys when none exist and writes them to .env", () => {
    const { deps, writes } = makeDeps();
    const result = runWalletNew(deps);
    expect(result.ok).toBe(true);
    expect(result.roles.map((r) => r.role)).toEqual(["buyer", "seller"]);
    for (const r of result.roles) {
      expect(r.action).toBe("created");
      expect(r.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    // Keys were persisted to the env file (the only place a full key may live).
    expect(writes).toHaveLength(1);
    expect(writes[0]?.contents).toContain(WALLET_ENV_KEYS.buyer);
    expect(writes[0]?.contents).toContain(WALLET_ENV_KEYS.seller);
    expect(writes[0]?.contents).toContain(TEST_KEY_A);
  });

  it("refuses to overwrite existing keys without --force (keeps them)", () => {
    const existing = `BUYER_PRIVATE_KEY=${TEST_KEY_A}\nSELLER_PRIVATE_KEY=${TEST_KEY_B}\n`;
    const { deps, writes } = makeDeps({ readEnvFile: () => existing });
    const result = runWalletNew(deps);
    expect(result.ok).toBe(true);
    expect(result.roles.every((r) => r.action === "kept")).toBe(true);
    // Nothing new to write when both are kept.
    expect(writes).toHaveLength(0);
    // Addresses still reported (derived from existing keys).
    expect(result.roles[0]?.address).toBe(privateKeyToAccount(TEST_KEY_A).address);
  });

  it("overwrites existing keys when --force is set", () => {
    const existing = `BUYER_PRIVATE_KEY=${TEST_KEY_A}\n`;
    const { deps, writes } = makeDeps({ readEnvFile: () => existing, force: true });
    const result = runWalletNew(deps);
    expect(result.ok).toBe(true);
    expect(result.roles.find((r) => r.role === "buyer")?.action).toBe("overwritten");
    expect(writes).toHaveLength(1);
  });

  it("NEVER leaks a full private key in the result object or the formatted output", () => {
    const { deps } = makeDeps();
    const result = runWalletNew(deps);
    const asJson = JSON.stringify(result);
    const asText = formatWalletNewResult(result);
    for (const key of [TEST_KEY_A, TEST_KEY_B]) {
      expect(asJson).not.toContain(key);
      expect(asText).not.toContain(key);
    }
    // But the redacted tail and the public addresses do appear in the human output.
    expect(asText).toContain(result.roles[0]?.address ?? "MISSING");
  });
});
