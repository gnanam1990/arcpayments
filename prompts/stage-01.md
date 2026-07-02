# Stage 1 — MCP server up + network wiring

**Goal:** `metered-mcp` runs as a bare MCP server with one **free** tool, and `arcpayments`'s
network layer + a real `arcpayments doctor` are extracted from what the app needed. Still no payments.

Read `CLAUDE.md` and `NETWORK.md` (from Stage 0) first. Use only verified values from `NETWORK.md`.

## Part A — App: bare MCP server (`apps/metered-mcp`)

- Stand up a minimal MCP server exposing **one free tool** (e.g. `echo` or a tiny util that returns
  a computed value). No payment gating yet.
- It must start locally and respond to a tool call.

## Part B — Extract into the tool: `network` module (`packages/arcpayments`)

The app needs to know how to reach Arc. Generalize that into a reusable module:

- A `network` module that loads RPC URL, chain ID, explorer from env (falling back to `NETWORK.md`
  verified values). **One switchable config** — testnet today, mainnet later, by env only.
- A viem client factory pointed at Arc testnet.

## Part C — `arcpayments doctor` (real, replaces the Stage 0 stub)

`doctor` checks and clearly reports:
- Bun/Node version meets minimum
- RPC reachable (a real call, e.g. chain ID / block number)
- Configured chain ID matches what the RPC returns
- Wallet present (env) — or a clear "no wallet configured yet (fine for Stage 1)"
Exit non-zero if any hard check fails; print a readable checklist.

## Tests to write first (TDD)

- [ ] `network` module returns the configured RPC/chain-ID/explorer from env
- [ ] client factory builds a viem client without throwing
- [ ] `doctor` passes against a **mock** RPC returning the matching chain ID
- [ ] `doctor` **fails** (non-zero) against a mock RPC returning a mismatched chain ID
- [ ] MCP server responds to a call to the free tool

## Done when

- [ ] `metered-mcp` starts and answers a tool call locally
- [ ] `arcpayments doctor` runs a real check against Arc testnet and reports a clean checklist
- [ ] Switching networks is env-only (no hardcoded endpoints anywhere)
- [ ] All tests green; CI green
- [ ] Conventional Commits on branch `stage-01`, PR, tagged `v0.1.0` after merge

## Do NOT

- No paywall, no wallet spending, no x402 yet (that's Stage 2–3).
- Do not hardcode endpoints — read from the `network` module only.
- Do not add a second tool or extra features the next stage doesn't need.
