import { InMemorySettlementQueue } from "arcpayments";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDashboardServer } from "../src/dashboard/server";
import { SellerState } from "../src/dashboard/state";
import type { DashboardModel } from "../src/dashboard/view-model";

const SELLER = "0xda6b000000000000000000000000000000000001";
let base: string;
let server: Awaited<ReturnType<typeof startDashboardServer>>["server"];

beforeAll(async () => {
  const state = new SellerState({
    queue: new InMemorySettlementQueue(),
    seller: { address: SELLER, network: "Arc testnet", price: "$0.001" },
    // no balanceReader, no guard → honest "unavailable" / "not configured"
    now: () => 1_700_000_000_000,
  });
  const started = await startDashboardServer({ state, port: 0 });
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

afterAll(() => server.close());

describe("dashboard server (read-only)", () => {
  it("serves the HTML page with the brand, and NO private key in the markup", async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("metered-mcp");
    expect(html).toContain("--violet"); // the designed token system shipped
    // read-only: the page never contains key material or a signing route
    expect(html).not.toMatch(/PRIVATE_KEY|0x[a-fA-F0-9]{64}/);
  });

  it("serves /api/state as the real model with honest empty states", async () => {
    const model = (await (await fetch(`${base}/api/state`)).json()) as DashboardModel;
    expect(model.seller.addressShort).toBe("0xda6b…0001");
    expect(model.feed).toEqual([]); // no invented payments
    expect(model.balance.state).toBe("unavailable"); // no reader configured
    expect(model.balance.error?.toLowerCase()).toContain("seller key");
    expect(model.safety.configured).toBe(false);
    expect(model.settlement.earned).toBe("0");
  });

  it("404s unknown routes and refuses non-GET (read-only surface)", async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(base, { method: "POST" })).status).toBe(405);
  });
});
