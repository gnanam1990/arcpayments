# Stage 0 — Foundations & Arc verification

**Goal:** a real, empty monorepo with green CI, a CLI skeleton, and all unverified Arc specifics
confirmed and recorded. No payment logic yet.

Read `CLAUDE.md` first. Follow every rule there.

## Part A — Verify Arc specifics (do this before writing config)

Confirm against the live Arc docs (check both `docs.arc.network` and `docs.arc.io` — find which is real):

1. Testnet **RPC URL**
2. Testnet **chain ID**
3. Testnet **explorer** URL
4. **Faucet** URL (expected `faucet.circle.com`)
5. Exact npm package names for: Circle Wallets SDK, CCTP SDK, x402 batching (expected
   `@circle-fin/x402-batching`), and Paymaster.

Write the confirmed values into a new `NETWORK.md` at the repo root, with the source URL for each.
If a value can't be confirmed, mark it `UNVERIFIED` and flag it — do not guess.

## Part B — Scaffold the monorepo

- Initialize a Bun workspace with two packages: `packages/arcpayments` and `apps/metered-mcp`.
- Configure TypeScript (strict), biome (lint + format), vitest, tsup.
- `packages/arcpayments`: a CLI skeleton exposing the `arcpayments` command with `arcpayments --help` and a
  `arcpayments doctor` **stub** that prints "not implemented yet" and exits 0.
- `apps/metered-mcp`: an empty package placeholder (real work starts Stage 1).
- Root `.gitignore` and `.env.example` are already present — extend if needed, don't remove entries.

## Part C — CI

- Ensure `.github/workflows/ci.yml` runs and passes: typecheck, lint, test, build.
- Add one trivial passing test in `packages/arcpayments` so the test job is real (e.g. a version-string test).

## Tests to write first (TDD)

- [ ] `arcpayments --help` exits 0 and prints usage including `doctor`.
- [ ] `arcpayments doctor` (stub) exits 0.
- [ ] A version test that asserts `package.json` version matches the CLI's reported version.

## Done when

- [ ] `NETWORK.md` exists with verified (or clearly-marked UNVERIFIED) values + sources
- [ ] `bun install && bun run build` succeeds
- [ ] `arcpayments --help` and `arcpayments doctor` run
- [ ] CI is green (typecheck + lint + test + build)
- [ ] Committed with Conventional Commits on branch `stage-00`, opened as a PR, tagged `v0.0.1` after merge

## Do NOT

- Do not wire any RPC calls, wallets, or payments yet.
- Do not hardcode any endpoint — that's Stage 1, and only from verified `NETWORK.md` values.
- Do not build anything in `apps/metered-mcp` beyond an empty placeholder.
