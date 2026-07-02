import { describe, expect, it } from "vitest";
import {
  type AddPaywallDeps,
  renderPaywallTemplate,
  runAddPaywall,
} from "../src/paywall-generator";

describe("renderPaywallTemplate", () => {
  it("scaffolds a gated tool wiring PaywallGuard with the given name and price", () => {
    const src = renderPaywallTemplate({ name: "premium_quote", price: "$0.002" });
    expect(src).toContain("PaywallGuard");
    expect(src).toContain("premium_quote");
    expect(src).toContain("$0.002");
    expect(src).toContain("arcpayments");
  });
});

function makeDeps(overrides: Partial<AddPaywallDeps> = {}): {
  deps: AddPaywallDeps;
  writes: Array<{ path: string; contents: string }>;
} {
  const writes: Array<{ path: string; contents: string }> = [];
  const deps: AddPaywallDeps = {
    name: "premium",
    price: "$0.001",
    outPath: "/tmp/out/premium.paywall.ts",
    force: false,
    fileExists: () => false,
    writeFile: (path, contents) => writes.push({ path, contents }),
    ...overrides,
  };
  return { deps, writes };
}

describe("runAddPaywall", () => {
  it("writes the scaffolded file when it does not exist", () => {
    const { deps, writes } = makeDeps();
    const result = runAddPaywall(deps);
    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.contents).toContain("PaywallGuard");
  });

  it("refuses to overwrite an existing file without --force", () => {
    const { deps, writes } = makeDeps({ fileExists: () => true });
    const result = runAddPaywall(deps);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exists/i);
    expect(writes).toHaveLength(0);
  });

  it("overwrites with --force", () => {
    const { deps, writes } = makeDeps({ fileExists: () => true, force: true });
    const result = runAddPaywall(deps);
    expect(result.ok).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
