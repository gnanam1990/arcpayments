# Changelog

All notable changes to `arcpayments`. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are the staged builds. Testnet only; not
affiliated with Circle/Arc.

## [0.8.0] — Scaffolder + publish (the launch)

- `arcpayments create <name>` scaffolds a working, testnet-wired starter (metered MCP server with a
  free + paid tool, a buyer agent, spend guards, and the `doctor`/`faucet`/`gateway:*` commands).
  Refuses impersonating names and won't overwrite a non-empty dir without `--force`.
- Publish-ready package: `files` allowlist ships `dist` + `templates` only (no tests, no `src`, no
  source maps), `exports`/`bin`/`engines`/`repository`/keywords, MIT, and a `prepublishOnly` gate.
- README (repo + package) with the non-affiliation + testnet disclaimers up top, CI/license badges;
  `docs/RELEASE.md`, `CONTRIBUTING.md`, issue templates.

## [0.7.0] — Seller dashboard

- A read-only live dashboard: real-time payment feed, Gateway balance, honest settlement status
  (accepted off-chain vs on-chain-completed kept distinct; never a faked tx link), and the safety-guard
  state. Dark + violet, built in the existing stack. No key or signing in the browser.

## [0.6.0] — Safety guards

- Composable `SpendGuard` safety kernel enforced **below the agent**, before signing: recipient
  allowlist, per-payment max, budget cap, rate limit, human-gate. Immutable at runtime; wired into the
  buyer loop with no bypass. Adversarial attack test suite.

## [0.5.0] — Seller cash-out

- `gateway:withdraw` (instant same-chain, gates on `available`) and `cctp:transfer` (CCTP v2 bridge:
  burn → attestation → mint) with backoff polling. Gated live cash-out script.

## [0.4.0] — Buyer agent (first on-chain)

- `payForCall` and `startPaymentLoop` (challenge → EIP-3009 sign → retry → result) with hard caps,
  `flushBatch` + `GatewayBatchSettler`. Settlement proven on-chain via read-only verification.

## [0.3.0] — x402 paywall

- `PaywallGuard` + `LocalExactVerifier` (auth vs Gateway rules, single-use nonce, expiry), settlement
  queue, `GatewaySettler`, and the `add paywall` generator. Paid `premium_echo` tool ($0.001).

## [0.2.0] — Wallets

- `wallet:new` generates buyer + seller keys into a gitignored `.env`; wallet seam (`LocalWallet`).

## [0.1.0] — CLI + network foundation

- The `arcpayments` CLI (`doctor`, `faucet`), the verified Arc testnet `network` module, and the
  metered-mcp app skeleton (free `echo` tool).

[0.8.0]: https://github.com/gnanam1990/arcpayments/releases/tag/v0.8.0
[0.7.0]: https://github.com/gnanam1990/arcpayments/releases/tag/v0.7.0
[0.6.0]: https://github.com/gnanam1990/arcpayments/releases/tag/v0.6.0
[0.5.0]: https://github.com/gnanam1990/arcpayments/releases/tag/v0.5.0
[0.4.0]: https://github.com/gnanam1990/arcpayments/releases/tag/v0.4.0
[0.3.0]: https://github.com/gnanam1990/arcpayments/releases/tag/v0.3.0
[0.2.0]: https://github.com/gnanam1990/arcpayments/releases/tag/v0.2.0
[0.1.0]: https://github.com/gnanam1990/arcpayments/releases/tag/v0.1.0
