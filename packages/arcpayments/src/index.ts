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
  type Eip712TokenDomain,
  loadNetworkConfig,
  type NetworkConfig,
  type NetworkEnv,
  USDC_ERC20_DECIMALS,
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
export {
  type BalanceReader,
  getBalance,
  type NativeBalance,
} from "./balance";
export {
  faucetCheck,
  type FaucetCheckResult,
  type FaucetTarget,
  formatFaucetInstructions,
} from "./faucet";
export {
  formatWalletNewResult,
  LocalWallet,
  parseEnv,
  redactSecret,
  type Role,
  type RoleAddress,
  runWalletNew,
  upsertEnvVars,
  WALLET_ENV_KEYS,
  type Wallet,
  type WalletNewDeps,
  type WalletNewResult,
  walletTargetsFromEnv,
  type WalletRoleResult,
} from "./wallet";
export { createWalletNewDeps, isEnvGitIgnored } from "./wallet-node";
export {
  buildPaymentRequirements,
  EIP3009_TRANSFER_TYPES,
  type Eip3009Authorization,
  type ExactPaymentPayload,
  flushSettlements,
  type FlushResult,
  type GuardOutcome,
  InMemoryNonceStore,
  InMemorySettlementQueue,
  LocalExactVerifier,
  type NonceStore,
  type PaymentRequirements,
  type PaymentVerifier,
  type PaywallConfig,
  PaywallGuard,
  type PaywallGuardConfig,
  priceToBaseUnits,
  type SettlementInput,
  type SettlementOutcome,
  type SettlementQueue,
  type SettlementRecord,
  type SettlementStatus,
  type Settler,
  type SignExactOptions,
  signExactPayment,
  type VerifyResult,
} from "./paywall";
export { type FacilitatorLike, GatewaySettler } from "./paywall-gateway";
export {
  type AddPaywallDeps,
  type AddPaywallResult,
  type RenderPaywallOptions,
  renderPaywallTemplate,
  runAddPaywall,
} from "./paywall-generator";
