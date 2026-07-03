# Contributing to arcpayments

Thanks for helping build agentic-commerce tooling for the Arc ecosystem. This is a **community
project — not affiliated with Circle or Arc.** Contributions of all sizes are welcome.

## Ground rules

- **Testnet only.** All USDC is test-value. **Never commit a private key or a `.env`** — testnet keys
  count as real. The repo is public; secrets are permanent once pushed.
- **TDD.** Write the failing test first, then the implementation. No behavior change without a test.
- **No hardcoded network values.** Endpoints, addresses, chain IDs, and domains come from `NETWORK.md`
  / the `network` module / env — never inline them.
- **Don't impersonate Circle/Arc.** Keep the non-affiliation line in docs and generated templates.

## Dev setup

```bash
git clone https://github.com/gnanam1990/arcpayments
cd arcpayments
bun install
bun run typecheck && bun run lint && bun run test && bun run build
```

Requires **Bun** and Node ≥ 20. The monorepo: `packages/arcpayments` (the toolkit) and
`apps/metered-mcp` (the showcase app + seller dashboard).

## Making a change

1. Branch off `main`.
2. Add/adjust tests first, then code. Keep the full gate green:
   `bun run typecheck && bun run lint && bun run test && bun run build`.
3. Use **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`), small and
   focused.
4. Open a PR against `main`. CI (typecheck + lint + test + build) and a secrets scan must pass.

## Where things live

- New CLI command → `packages/arcpayments/src/cli.ts` (+ a pure core module + tests).
- Scaffolder starter → `packages/arcpayments/templates/starter/` (+ update the manifest in `create.ts`).
- Docs/decisions → `docs/` (ADRs, runbooks, this release process).

## Reporting bugs / ideas

Open an issue using the templates. For anything touching keys or funds, describe it on **testnet**
terms and never paste a private key.
