# Stage 2 — Wallets & faucet

**Goal:** generate buyer + seller wallets, fund them from the faucet, and read their balance —
so a later stage has identities to pay from/to. Still no paywall or payment logic.

Read `CLAUDE.md`, `NETWORK.md`, and the current code first. Apply the secrets rules automatically:
the repo is PUBLIC — never commit a key, run the `git status` gate before every commit.

## Wallet model (decided)

Use a **local viem keypair** for testnet: `generatePrivateKey()` / `privateKeyToAccount()`, keys
loaded from env (gitignored `.env`). This keeps the agent self-custodial with no external API
dependency — right for a testnet demo where an agent pays autonomously.

**Build a seam, not a hardcoding.** Define a small `Wallet` interface (e.g. `getAddress()`,
`getAccount()` / signer) with a `LocalWallet` implementation now, so a `CircleWallet` backend
(`@circle-fin/developer-controlled-wallets`) can be swapped in later **without changing callers**.
Do not implement the Circle backend in this stage — just leave the interface seam.

## Part A — Tool: `arcpayments wallet:new` (`packages/arcpayments`)

- Generates a buyer and a seller keypair.
- Writes them to `.env` as `BUYER_PRIVATE_KEY` / `SELLER_PRIVATE_KEY` **only if not already set**
  (never overwrite existing keys without an explicit `--force`); also prints the **public addresses**.
- **Never prints a full private key.** If it must reference a key at all, redact to the last 4 chars.
- Confirm `.env` is gitignored before writing; if `.env` would be tracked, abort with a clear error.

## Part B — Tool: `arcpayments faucet` (`packages/arcpayments`)

- Prints the faucet URL (`https://faucet.circle.com`) and the address(es) to fund (buyer/seller).
- Optionally `--check <address>`: reads the on-chain balance and reports whether funds have landed.
- Balance read uses the viem client from the Stage 1 `network` module.

## Part C — Balance read + decimals (`packages/arcpayments`)

- Add a `getBalance(address)` helper returning the account's **native USDC (gas) balance**.
- **Respect the decimals note in NETWORK.md:** the native/gas USDC representation is **18 decimals**,
  while the USDC **ERC-20 is 6 decimals**. Format the native balance from 18 decimals here. Do NOT
  conflate the two — the 6-decimal ERC-20 path arrives when we handle x402 amounts (Stage 3).
  Centralize both scales as named constants so nothing downstream guesses.

## Part D — App wiring (`apps/metered-mcp`)

- The server reads a `SELLER_ADDRESS` (or derives it from `SELLER_PRIVATE_KEY`) from env as its
  payout identity. No receiving/settlement yet — just hold the identity for Stage 3.

## Tests first (TDD)

- [ ] `wallet:new` produces valid keypairs whose derived address matches viem's derivation
- [ ] `wallet:new` never emits a full private key in any output (assert redaction)
- [ ] `wallet:new` refuses to overwrite existing keys without `--force`
- [ ] `getBalance` formats an 18-decimal native value correctly (mock client) — e.g. 1 USDC, 0.5, dust
- [ ] decimals constants: native=18, erc20=6 (guard test so no one flips them)
- [ ] `faucet --check` reports "funded" vs "empty" correctly against a mock balance
- [ ] app resolves `SELLER_ADDRESS` from env / derived from `SELLER_PRIVATE_KEY`

## Done when

- [ ] `arcpayments wallet:new` generates buyer+seller, writes to gitignored `.env`, prints addresses, leaks no key
- [ ] `arcpayments faucet` prints the URL + `--check` reports real testnet balance
- [ ] Native (18) vs ERC-20 (6) decimals are explicit, tested constants — never conflated
- [ ] metered-mcp knows its seller identity from env
- [ ] All tests green; CI green; no secret committed (git-status gate + GitGuardian clean)
- [ ] Conventional Commits on branch `stage-02`, PR opened. Tag `v0.2.0` left to me after merge.

## Do NOT

- No x402 paywall, no payment signing, no transfers yet (Stage 3).
- Do not implement the Circle wallet backend — only the interface seam.
- Do not print, log, snapshot, or commit any private key. Ever.
- Do not hardcode endpoints — use the Stage 1 `network` module.
