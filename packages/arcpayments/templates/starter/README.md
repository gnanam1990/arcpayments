# __APP_NAME__

A metered MCP server + buyer agent on **Arc testnet**, scaffolded by
[`arcpayments`](https://github.com/gnanam1990/arcpayments). An AI agent pays sub-cent USDC per tool
call; spend guards bound what the agent can do.

> ⚠️ **Testnet only** — all USDC is test-value. **Not affiliated with Circle or Arc**; this is a
> community starter built on the public Arc testnet.

## Quickstart

```bash
npm install
npx arcpayments wallet:new     # writes buyer + seller keys into a gitignored .env
npx arcpayments faucet         # prints the faucet URL + your addresses (get testnet USDC)
npm run doctor                 # checks runtime, RPC, chain ID, wallet

npm start                      # run the metered MCP server over stdio
npm run buyer                  # run the buyer agent (pays per call, guards enforced)
```

Nothing here needs patching beyond filling `.env`.

## What's inside

- `src/server.ts` — a metered MCP server: a free `echo` tool and an x402-gated `premium_echo`
  ($0.001/call). Payments verify locally and queue for Circle Gateway batch settlement.
- `src/buyer.ts` — a buyer agent that pays per call. A `SpendGuard` authorizes **every** payment
  **before it is signed**, so even a compromised agent can't exceed the budget or pay an unlisted
  recipient. The recipient allowlist defaults to your seller address.
- `.env.example` — keys (empty; fill via `wallet:new`) + optional `ARC_GUARD_*` limits.

## Safety

Limits are enforced in the payment path, below the agent, and are immutable at runtime. Configure them
in `.env` (`ARC_GUARD_BUDGET_CAP`, `ARC_GUARD_ALLOWLIST`, `ARC_GUARD_RATE_MAX`, …). See the
[arcpayments safety notes](https://github.com/gnanam1990/arcpayments#safety).

## License

MIT.
