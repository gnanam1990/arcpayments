# Two-Project Build Plan — metered-mcp drives arcpayments

**One story, two shippable projects, built app-first.**

- **Project A — `arcpayments`** (infrastructure / the headline): a scaffolder + CLI for building
  agentic-commerce apps on Arc. `npx create-arc-app` + an `arc` CLI.
- **Project B — `metered-mcp`** (the showcase / customer zero): a metered MCP tool server —
  an AI agent pays sub-cent USDC on Arc for each tool call.

**The method:** you don't build the tool in a vacuum. You build metered-mcp, and every time it needs
plumbing (wallet, paywall, batching, safety), you build that piece **once, cleanly, generalized** —
that extracted piece *becomes* arcpayments. When metered-mcp works end-to-end, arcpayments is the tooling you
pulled out of it, already proven by a real app.

> Names are placeholders. **Project B is swappable** — a paid data-oracle or paid API works
> identically and changes none of arcpayments's stages.

---

## Guardrails

- **Two, not three.** A third project pulls focus before either is finished. Hold the line.
- **B drives A.** Never build an arcpayments feature metered-mcp doesn't actually need yet.
- Discipline: git tag per stage on **both** packages, TDD (test before wiring the real SDK),
  clean commits, adversarial review of the safety layer.

---

## 0. Verify before you type (10 min, saves days)

Confirm against the live docs quickstart — the source docs disagree:
- Docs domain: `docs.arc.network` vs `docs.arc.io`
- Testnet RPC URL + Chain ID (`rpc.testnet.arc.network` / `5042002` — unconfirmed)
- Explorer `testnet.arcscan.app`; Faucet `faucet.circle.com`
- Confirmed reference repos to study: `circlefin/arc-node`, `circlefin/arc-nanopayments`
- SDK names: `arc-nanopayments` uses `@circle-fin/x402-batching/client` + a `withGateway()` wrapper.
  Confirm exact package names for Circle Wallets, CCTP, Paymaster in the docs.

---

## Stack & repo layout

- **TypeScript on Bun.** viem (EVM client). vitest (tests). biome (lint/format). tsup (build).
- **Monorepo** (bun workspace) during the build — makes extraction natural:
  ```
  repo/
    packages/arcpayments/     # Project A — CLI + libs (published to npm)
    apps/metered-mcp/      # Project B — the MCP server + buyer agent + dashboard
  ```
- Ship as **two stories**: arcpayments = npm package + docs; metered-mcp = public repo + live testnet demo.
- **CI:** GitHub Actions — typecheck + lint + test green before any tag.

---

## Staged build (each stage: build B's need → extract into A → tag both)

### Stage 0 — Foundations → `arcpayments v0.0.1` / `metered-mcp v0.0.1`
- Monorepo, Bun workspace, biome, vitest, tsup, CI green.
- CLI skeleton: `arc --help`, `arc doctor` stub.
- Complete the Section 0 verification.

### Stage 1 — MCP server up + network wiring → `v0.1.0`
- **B:** stand up a bare MCP server exposing **one free tool** (e.g. a small data/util tool). Runs locally, no payment yet.
- **Need → A:** Arc testnet client config (RPC, chain ID, explorer) as one source of truth. Extract into arcpayments `network` module + real `arc doctor` (checks Bun/Node version, RPC reachability, chain-ID match, wallet presence).
- **Tests:** config validation; doctor vs mock RPC.

### Stage 2 — Wallets + faucet → `v0.2.0`
- **B:** metered-mcp needs a **seller payout wallet**; the test buyer needs a wallet.
- **Need → A:** `arc wallet:new` (buyer + seller, mirrors the reference repo's generate-wallets), `arc faucet` (guided flow to faucet.circle.com + balance check).
- **Tests:** wallet creation; balance read (mocked).

### Stage 3 — Paywall the tool with x402 → `v0.3.0`  *(core primitive)*
- **B:** wrap the MCP tool call so it responds **only after** an x402 payment (sub-cent USDC) — verify signature locally, queue for batch settlement (the `withGateway()` pattern).
- **Need → A:** extract the generalized paywall generator — `arc add paywall` (Next.js route + Hono middleware + MCP-tool variants).
- **Tests:** payment-present vs absent; price enforcement (mocked verifier).

### Stage 4 — Buyer agent pays per call → `v0.4.0`
- **B:** a demo agent (MCP client / Claude Agent SDK) that calls the paid tool repeatedly, paying via Gateway batching — signs locally, no tx broadcast per call.
- **Need → A:** extract the buyer-agent template + `@circle-fin/x402-batching/client` wiring + a `startPaymentLoop()`-style helper.
- **Tests:** loop makes N payments; respects a hard call cap.

### Stage 5 — Seller withdraws earnings (CCTP) → `v0.5.0`
- **B:** move accumulated USDC off Arc cross-chain.
- **Need → A:** extract `arc add cctp` helper.
- **Tests:** transfer intent builds correctly (mocked).

### Stage 6 — Safety guards → `v0.6.0`  *(the differentiator)*
- **B:** the buyer agent gets **budget caps, rate limits, recipient allowlist, human-gate** for transfers over a threshold — enforced below the agent so a prompt-injection or logic bug can't drain the treasury.
- **Need → A:** extract the safety module; this is what makes arcpayments more than a thin wrapper.
- **Tests (adversarial):** simulate a runaway agent + an injected "send everything" instruction; assert guards hold and the human-gate blocks.

### Stage 7 — Scaffolder + dashboard → `v0.7.0`
- **A:** the extracted modules become the `create-arc-app` template — `npx create-arc-app` emits a project shaped like metered-mcp (paid tool + buyer agent + safety, testnet-wired).
- **B:** seller dashboard (live payments + Gateway balance), clean README, deploy a testnet demo.

### Stage 8 — E2E, docs, publish → `arcpayments v1.0.0` / `metered-mcp v1.0.0`
- End-to-end run on live Arc testnet (real faucet USDC).
- **A:** publish arcpayments to npm (MIT), docs/README, demo GIF.
- **B:** public repo, live demo link, demo GIF.
- **Deliverable:** `npx create-arc-app` → running metered-MCP demo in minutes, *and* metered-mcp live as proof.

---

## 4–6 week timeline (solo, part-time)

| Week | Stages | Milestone |
|------|--------|-----------|
| 1 | 0–1 | MCP server runs, testnet reachable, `arc doctor` green |
| 2 | 2–3 | Wallets + faucet + first paid tool call working |
| 3 | 4–5 | Buyer agent pays in a loop; CCTP withdrawal works |
| 4 | 6 | Safety guards pass adversarial tests |
| 5 | 7 | `create-arc-app` emits a metered-mcp-shaped app; dashboard live |
| 6 | 8 | E2E on testnet, docs, both at `v1.0.0` |

---

## Content cadence (build-in-public, not farming)

Each dual-tag = one substantive post with a real artifact (demo GIF / snippet / lesson).
The **"B taught A what to build"** angle is itself great content:

- v0.1 — "Stood up an MCP server + wired a CLI to Arc testnet." + GIF
- v0.3 — "Made an AI agent pay sub-cent USDC to call an MCP tool. One command scaffolds the paywall." + snippet
- v0.4 — "Agent making batched nanopayments per tool call on Arc, no tx broadcast." + GIF
- v0.6 — "Building the app taught me the tool needed real spend guards. Agent physically can't drain its wallet now — adversarial tests inside." + thread
- v1.0 — "`npx create-arc-app` → running paid-MCP demo on Arc in minutes. Here's the live app I built with it." + demo

Channels: build-log + GIFs on X/Farcaster · progress + technical answers on **Arc House** (daily
points) · commits + `DEVLOG.md` on GitHub. Same work, format-fit per place — don't identical-cross-post.

---

## Turn it into recognition (the scoring layer)

- **Hackathon:** arcpayments in the developer-tooling track; metered-mcp as the app demo.
- **Circle Developer Grant** (`circle.com/grant`): file for arcpayments — tooling that accelerates building is squarely fundable, and metered-mcp is your "it actually works" proof.
- **One guest post:** "Building create-arc-app by building a real app on top of it."
- **Answer real forum/Discord questions** — especially from people trying the tool.
- **Never ask for a Discord role** — bannable. Let the working tool + live app + track record speak.

---

## Definition of done (v1.0)

- [ ] `npx create-arc-app my-app` produces a project that runs on Arc testnet with no manual patching
- [ ] metered-mcp is live on testnet: an agent pays per MCP tool call, end-to-end
- [ ] Paywall, buyer agent, CCTP withdrawal, safety guards all work and are covered by tests
- [ ] Adversarial safety tests pass in CI
- [ ] arcpayments published to npm (MIT); metered-mcp public with a live demo link
- [ ] One demo GIF each + one guest post drafted
