# PRD — arcpayments & metered-mcp

**Agentic-commerce tooling for Arc, proven by a live app.**
Status: Draft v1 · Owner: solo builder · Target: Arc public testnet (mainnet-ready by config)

> **Two projects, one story.** `arcpayments` is the infrastructure; `metered-mcp` is the app built with it
> that proves it works. This PRD scopes both. Names are placeholders (see Open Questions Q1).

---

## Shared Context

**Background.** Arc is Circle's stablecoin-native L1 (USDC as gas, sub-second finality, EVM-compatible),
live in public testnet since Oct 2025, mainnet beta targeted 2026. Its flagship narrative is *agentic
commerce* — AI agents that autonomously pay for APIs, tools, and compute in USDC via x402 + Circle
Gateway nanopayments. The app talks to Arc over RPC; it hosts like any web app (Vercel/Fly), so it's
fully hostable today on testnet and flips to mainnet with one config change.

**Why now.** Mainnet is close and the ecosystem is early — tooling that lowers the barrier to building
agentic-commerce apps is the category Circle amplifies most, because every builder it onboards is one
they didn't have to. Shipping working, tested, *used* infra now is the strongest position to be in when
mainnet opens.

**Primary goal (both projects).** A real, legible contribution to the Arc ecosystem that earns
recognition through demonstrated usefulness — not visibility theater.

---

# Project A — arcpayments (tooling)

*A scaffolder + CLI that gets a developer from zero to a working agentic-commerce app on Arc in minutes.*

## Problem Statement
Every developer building agentic commerce on Arc re-wires the same fiddly plumbing by hand: agent
wallets, x402 paywalls, Gateway nanopayment batching, cross-chain withdrawal, and spend guardrails.
It's error-prone, undocumented as a whole, and the #1 reason a promising idea stalls before a working
demo. There is no `create-next-app` equivalent for Arc.

## Goals
1. A stranger runs one command and reaches a working, testnet-connected demo in **under 10 minutes**.
2. Cover the full agentic-commerce path end-to-end: **wallet → paywall → paying agent → withdrawal → safety**.
3. Make **testnet→mainnet a single config change** (RPC + chain ID), so apps built now survive the mainnet flip.
4. Ship as reusable, documented, tested infrastructure others can adopt, not a one-off demo.
5. Be adopted by **at least one external builder** (issue, fork, or "I used this") within 30 days of launch.

## Non-Goals
- **Not a wallet or a chain.** arcpayments wires up Circle Wallets / Arc; it doesn't replace them. (Scope, trust.)
- **Not multi-chain.** Arc-first. Cross-chain is only CCTP withdrawal, not a general bridge abstraction. (Focus.)
- **Not an app.** arcpayments is plumbing; the app is metered-mcp. (Separation of concerns.)
- **No mainnet real-money handling in v1.** Testnet only until Arc mainnet beta is reachable. (Safety, availability.)
- **Not a UI framework.** Generates starter templates; doesn't own the app's design system. (Scope.)

## Target Users
- **Hackathon / indie builder** shipping an agentic-commerce demo on a deadline (primary).
- **Backend/infra dev** evaluating Arc who wants a correct reference wiring, not toy snippets.
- **AI-agent developer** who needs to make an agent *pay* for something and doesn't want to learn x402 from scratch.

## User Stories
- As a builder, I want `npx create-arc-app` to emit a running project so I can see a real payment flow before writing any code.
- As a builder, I want `arc doctor` to tell me exactly what's misconfigured (RPC, chain ID, wallet, faucet balance) so I stop losing hours to setup.
- As an AI-agent dev, I want a paywall generator so I can charge per request without hand-writing x402 verification.
- As an AI-agent dev, I want a buyer-agent template that batches nanopayments so my agent can make thousands of sub-cent calls affordably.
- As a builder, I want built-in spend guards so a bug or prompt injection can't drain my agent's wallet.
- As a builder, I want one config value to switch testnet→mainnet so I don't rewrite when Arc goes live.

## Requirements

**Must-Have (P0)** — feature isn't viable without these:
- **CLI core** (`arc --help`, `arc doctor`). *AC:* doctor reports Bun/Node version, RPC reachability, chain-ID match, wallet presence, faucet balance; exits non-zero on any failure.
- **Network config module.** *AC:* single source of truth for RPC/chain-ID/explorer; switching networks is one env var; no endpoint hardcoded in app code.
- **Wallet + faucet** (`arc wallet:new`, `arc faucet`). *AC:* generates buyer + seller wallets; guided faucet flow; balance read succeeds on testnet.
- **x402 paywall generator** (`arc add paywall`). *AC:* generated endpoint returns 402 without valid payment, returns content with it; verifies signature locally; price configurable.
- **Buyer-agent template** (Gateway batching). *AC:* agent makes N paid calls in a loop, signs locally (no per-call broadcast), respects a hard call cap.
- **Safety module.** *AC:* budget cap, rate limit, recipient allowlist, human-gate over a threshold — enforced below the agent; adversarial test (injected "send everything") is blocked.
- **Scaffolder** (`npx create-arc-app`). *AC:* emits a project that runs on testnet with zero manual patching.

**Nice-to-Have (P1)** — fast follows:
- CCTP withdrawal helper (`arc add cctp`).
- Framework variants for the paywall (Next.js route + Hono middleware + MCP-tool wrapper).
- `arc deploy` shortcuts (Vercel/Fly config generation).

**Future Considerations (P2)** — design for, don't build:
- Paymaster / multi-stablecoin gas support.
- Mainnet real-money mode with extra confirmations.
- Plugin system for community-contributed generators.

---

# Project B — metered-mcp (showcase app)

*A metered MCP tool server: an AI agent pays sub-cent USDC on Arc for each tool call.*

## Problem Statement
MCP tool servers give AI agents capabilities, but there's no clean, standard way to **monetize a tool
per call** — today it's flat API keys or nothing. metered-mcp demonstrates pay-per-tool-call settlement on
Arc, and in doing so serves as arcpayments's "customer zero": building it real forces arcpayments to be correct.

## Goals
1. A live demo where an AI agent autonomously pays per MCP tool call, end-to-end on Arc testnet.
2. Be built **entirely on arcpayments** — every plumbing need is met by (and extracted into) arcpayments.
3. Serve as the **proof artifact**: "here's a real app I built in a day with my own tooling."
4. Produce a **15-second demo GIF** that makes the payment flow obviously real.

## Non-Goals
- **Not a general MCP marketplace.** One server, a couple of metered tools — enough to prove the pattern.
- **Not production multi-tenant SaaS.** Single-operator demo. (Scope.)
- **No bespoke plumbing.** If metered-mcp needs something, it goes into arcpayments first, then metered-mcp uses it. (Enforces the method.)

## Target Users (of the demo's narrative)
- **The Arc/Circle team & grant reviewers** — the audience the proof is aimed at.
- **Other agent builders** who see "paid MCP tools on Arc" and want the same for their tools.

## User Stories
- As an agent operator, I want my agent to call a paid MCP tool and have payment settle automatically so I pay only for what I use.
- As a tool provider, I want each call to my tool to require a sub-cent USDC payment so I can monetize usage directly.
- As a tool provider, I want a dashboard showing live payments and my Gateway balance so I can see it working.
- As a tool provider, I want to withdraw earnings cross-chain so the money isn't stuck on Arc.

## Requirements

**Must-Have (P0):**
- **MCP server with ≥1 metered tool.** *AC:* tool responds only after a valid x402 payment; unpaid calls are rejected cleanly.
- **Paying buyer agent.** *AC:* an MCP client / agent calls the tool repeatedly and pays via arcpayments's batching template; spend guards active.
- **Seller dashboard.** *AC:* shows live payments and current Gateway balance in real time.
- **Live testnet deployment.** *AC:* reachable public URL (free host); demo runnable by a stranger from the README.

**Nice-to-Have (P1):**
- A second metered tool to show it generalizes.
- CCTP withdrawal wired into the dashboard.

**Future Considerations (P2):**
- Per-tool dynamic pricing; usage analytics.

---

## Shared Success Metrics

**Leading (days–weeks):**
- **Time-to-demo:** a new user reaches a running demo in <10 min (self-test + one external tester). *Success:* <10 min; *stretch:* <5 min.
- **Setup-failure rate:** `arc doctor` catches misconfig before it wastes time. *Success:* 0 silent setup failures in external tests.
- **External touch:** ≥1 non-author interaction (issue/fork/reply/try) within 30 days. *This is the single most important legitimacy signal.*
- **Build-in-public trail:** ≥1 substantive post per stage tag, each shipping a real artifact.

**Lagging (weeks–months):**
- **Ecosystem recognition:** hackathon placement OR a Circle Developer Grant decision on arcpayments.
- **Architects progress:** reach Tier 1 (500 pts) via genuine activity (guest post, forum answers, hackathon, daily activity); progress toward Tier 2 (3,500) where role applications open.
- **Adoption:** arcpayments npm installs / repo stars trending up from real users (not vanity spikes).

**Explicit anti-metric:** raw post volume or role acquisition speed. Optimizing those triggers the
farming behavior Arc penalizes and defeats the goal.

---

## Constraints & Dependencies
- **Testnet only** until Arc mainnet beta is reachable; all USDC is test value.
- **Unverified specifics** (blocking Stage 0): exact testnet RPC URL + chain ID, docs domain (`arc.network` vs `arc.io`), and non-`arc-nanopayments` SDK package names (Circle Wallets, CCTP, Paymaster). Confirm against live docs before wiring.
- **Confirmed references:** `circlefin/arc-node`, `circlefin/arc-nanopayments` (uses `@circle-fin/x402-batching/client` + `withGateway()`).
- **Free hosting:** paywall/dashboard on Vercel; always-on buyer agent on Fly/Railway (or run locally for the GIF).
- **Solo builder, ~4–6 weeks part-time.**

## Open Questions
- **Q1 (blocking, you):** Final names. `create-arc-app`/`arcpayments` risk reading as *official Circle* — a rename and credibility risk. Recommend a clearly community-built brand with "for Arc" in the tagline, not the name. Check npm + GitHub availability before committing.
- **Q2 (eng, Stage 0):** Are the Circle Wallets / CCTP SDK package names + testnet RPC/chain-ID as documented? Blocks Stages 1–2.
- **Q3 (non-blocking):** Does the paid-MCP framing beat a paid data-oracle for Project B? Both dogfood arcpayments identically — swap freely if a better B emerges.
- **Q4 (non-blocking):** Domain — skip until name is locked and something's live on a free subdomain; then one cheap domain for credibility.

## Timeline & Phasing
Six phases, ~1 week each, dual-tagged (`arcpayments vX.Y` / `metered-mcp vX.Y`). Method is **app-first: B's need drives A's extraction.**

| Phase | Focus | Exit criteria |
|---|---|---|
| 1 | Foundations + network wiring | MCP server runs, `arc doctor` green on testnet |
| 2 | Wallets + first paid tool call | agent pays once for a tool call, verified |
| 3 | Batching + CCTP | agent pays in a loop; earnings withdrawable |
| 4 | Safety guards | adversarial spend tests pass in CI |
| 5 | Scaffolder + dashboard | `create-arc-app` emits a metered-mcp-shaped app; dashboard live |
| 6 | E2E + docs + publish | both at v1.0.0; npm + live demo + GIFs |

**Then:** hackathon entry (arcpayments = tooling track, metered-mcp = app demo), Circle Developer Grant filing, one guest post, ongoing forum answers. Never a direct Discord role request.

## Definition of Done (v1.0)
- [ ] `npx create-arc-app` → runs on Arc testnet with no manual patching
- [ ] metered-mcp live: an agent pays per MCP tool call, end-to-end
- [ ] Paywall, buyer agent, CCTP, safety guards all covered by tests; adversarial tests pass in CI
- [ ] arcpayments on npm (MIT); metered-mcp public repo + live demo link
- [ ] Demo GIF for each; one guest post drafted
- [ ] Names locked and trademark-safe (Q1 resolved)
