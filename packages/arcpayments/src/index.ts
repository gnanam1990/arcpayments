/**
 * arcpayments — public library surface.
 *
 * Stage 1 exposes the CLI primitives, the network config/client factory, and the
 * doctor diagnostics. Wallets, paywall, batching, CCTP, and safety modules are
 * extracted here in later stages as `metered-mcp` needs them.
 */
export { run, type CliResult } from "./cli";
export { VERSION } from "./version";
export {
  ARC_NATIVE_GAS_DECIMALS,
  ARC_TESTNET_DEFAULTS,
  type ArcPublicClient,
  createArcPublicClient,
  defineArcChain,
  loadNetworkConfig,
  type NetworkConfig,
  type NetworkEnv,
} from "./network";
export {
  type CheckStatus,
  detectRuntime,
  type DoctorCheck,
  type DoctorDeps,
  type DoctorReport,
  formatDoctorReport,
  type RuntimeInfo,
  runDoctor,
  runDoctorFromEnv,
} from "./doctor";
