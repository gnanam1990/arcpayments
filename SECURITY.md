# Security Policy

## Testnet only
This project targets the **Arc public testnet**. All USDC is test-value. Do **not** use mainnet keys
or real funds. Never commit private keys, `.env` files, or keystores — see `.gitignore`.

## Reporting a vulnerability
Please open a private security advisory on the GitHub repo, or contact the maintainer directly,
rather than filing a public issue. We aim to acknowledge within a few days.

## Scope notes
- The agent spend guards (budget caps, rate limits, allowlists, human-gate) are a core safety feature.
  Reports that bypass these are high priority.
- Do not include secrets or exploit payloads in public issues.
