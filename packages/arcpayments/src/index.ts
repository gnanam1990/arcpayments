/**
 * arcpayments — public library surface.
 *
 * Stage 0 exposes only the CLI primitives and the version. Network config,
 * wallets, paywall, batching, CCTP, and safety modules are extracted here in
 * later stages as `metered-mcp` needs them.
 */
export { run, type CliResult } from "./cli";
export { VERSION } from "./version";
