# arcpayments

**Agentic-commerce tooling for Arc.** A scaffolder + CLI to build apps where AI agents pay
sub-cent USDC on [Arc](https://www.arc.io) — wallets, x402 paywalls, Gateway nanopayment batching,
cross-chain withdrawal, and spend guards, wired for you.

<!-- badges: enable after the repo + CI exist -->
<!-- [![CI](https://github.com/gnanam1990/arcpayments/actions/workflows/ci.yml/badge.svg)](https://github.com/gnanam1990/arcpayments/actions/workflows/ci.yml) -->
<!-- ![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg) -->

> ⚠️ **Testnet.** Targets Arc public testnet; all USDC is test-value. Not affiliated with Circle/Arc —
> a community project *for* the Arc ecosystem.

## Why
Every builder re-wires the same agentic-commerce plumbing on Arc by hand. `arcpayments` is the
`create-*-app` for it: one command to a working, testnet-connected demo.

## Quickstart
```bash
# (available after Stage 8 publish)
npx arcpayments create my-app
cd my-app
arcpayments doctor      # checks RPC, chain ID, wallet, faucet balance
```

## Repo layout
```
packages/arcpayments/   # the tool — CLI + libs
apps/metered-mcp/        # the showcase app — a metered MCP tool server (customer zero)
prompts/                 # staged Claude Code build prompts
PRD.md · BUILD_PLAN.md · NETWORK.md · CLAUDE.md
```

## Status
Built in public, stage by stage. See `BUILD_PLAN.md` for the roadmap and `prompts/` for each stage.

## License
MIT — see `LICENSE`.
