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
  GATEWAY_AUTH_BACKDATE_SECONDS,
  GATEWAY_AUTH_VALIDITY_BUFFER_SECONDS,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
  GATEWAY_MIN_AUTH_VALIDITY_SECONDS,
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
  type ResourceInfo,
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
export {
  createGatewayBalanceReader,
  createGatewayDepositor,
  createSettlementResolver,
  describeGatewayError,
  describeThrownError,
  type FacilitatorLike,
  type FacilitatorResponse,
  GatewayBatchSettler,
  GatewaySettler,
  type GatewayVerifyResult,
  settlementOutcomeFrom,
} from "./paywall-gateway";
export {
  extractTxHash,
  isOnChainTxHash,
  type ResolveSettlementOptions,
  resolveSettlementTxHash,
  type SettlementResolver,
  type TransferInfo,
  type TransferStatus,
} from "./gateway-settlement";
export {
  type DepositResult,
  formatGatewayDepositReport,
  type GatewayDepositor,
  type GatewayDepositReport,
  runGatewayDeposit,
} from "./gateway-deposit";
export {
  formatGatewayBalances,
  type GatewayBalanceReader,
  type GatewayBalanceReport,
  type GatewayBalances,
  runGatewayBalance,
} from "./gateway-balance";
export {
  type BatchSettleOutcome,
  type BatchSettler,
  flushBatch,
  guardTransport,
  type LoopStop,
  type PaidCallResult,
  type PaidResponse,
  type PaidToolTransport,
  type PayForCallOptions,
  payForCall,
  type PaymentLoopResult,
  startPaymentLoop,
  type StartPaymentLoopOptions,
} from "./buyer";
export {
  type AddPaywallDeps,
  type AddPaywallResult,
  type RenderPaywallOptions,
  renderPaywallTemplate,
  runAddPaywall,
} from "./paywall-generator";
