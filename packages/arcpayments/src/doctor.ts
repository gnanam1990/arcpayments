import {
  type NetworkConfig,
  type NetworkEnv,
  createArcPublicClient,
  loadNetworkConfig,
} from "./network";

export type CheckStatus = "pass" | "warn" | "fail";

/** One line in the doctor checklist. */
export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

/** Result of a doctor run. `ok` is false iff any check hard-failed. */
export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
}

/** Identifies the JS runtime doctor is executing under. */
export interface RuntimeInfo {
  name: string;
  version: string;
}

/** Injectable dependencies so doctor is unit-testable against a mock RPC. */
export interface DoctorDeps {
  config: NetworkConfig;
  runtime: RuntimeInfo;
  /** Fetches the chain ID from the live RPC (injected → mockable in tests). */
  getRemoteChainId: () => Promise<number>;
  /** Whether any wallet key is configured. A boolean only — never the key itself. */
  hasWallet: boolean;
  /** Minimum Node major version. Defaults to {@link DEFAULT_MIN_NODE_MAJOR}. */
  minNodeMajor?: number;
}

const DEFAULT_MIN_NODE_MAJOR = 20;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function runtimeCheck(runtime: RuntimeInfo, minNodeMajor: number): DoctorCheck {
  const major = Number.parseInt(runtime.version.replace(/^v/, "").split(".")[0] ?? "", 10);

  if (runtime.name === "node") {
    if (Number.isNaN(major)) {
      return {
        name: "Runtime",
        status: "fail",
        detail: `could not parse Node version "${runtime.version}"`,
      };
    }
    return major >= minNodeMajor
      ? { name: "Runtime", status: "pass", detail: `Node ${runtime.version} (>= ${minNodeMajor})` }
      : {
          name: "Runtime",
          status: "fail",
          detail: `Node ${runtime.version} is below the required v${minNodeMajor}`,
        };
  }

  // Bun (or another modern runtime) — accept and report the version.
  return { name: "Runtime", status: "pass", detail: `${runtime.name} ${runtime.version}` };
}

/**
 * Run the diagnostic checks and return a structured report.
 *
 * Hard failures (exit non-zero): unsupported runtime, RPC unreachable, chain-ID
 * mismatch. A missing wallet is a non-fatal warning (fine for Stage 1).
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const minNodeMajor = deps.minNodeMajor ?? DEFAULT_MIN_NODE_MAJOR;
  const checks: DoctorCheck[] = [];

  checks.push(runtimeCheck(deps.runtime, minNodeMajor));

  let remoteChainId: number | undefined;
  try {
    remoteChainId = await deps.getRemoteChainId();
    checks.push({
      name: "RPC reachable",
      status: "pass",
      detail: `${deps.config.rpcUrl} responded (chainId ${remoteChainId})`,
    });
  } catch (err) {
    checks.push({
      name: "RPC reachable",
      status: "fail",
      detail: `${deps.config.rpcUrl} unreachable: ${errMessage(err)}`,
    });
  }

  if (remoteChainId === undefined) {
    checks.push({ name: "Chain ID match", status: "fail", detail: "skipped — RPC unreachable" });
  } else if (remoteChainId === deps.config.chainId) {
    checks.push({
      name: "Chain ID match",
      status: "pass",
      detail: `configured chainId ${deps.config.chainId} matches the RPC`,
    });
  } else {
    checks.push({
      name: "Chain ID match",
      status: "fail",
      detail: `configured chainId ${deps.config.chainId} != RPC chainId ${remoteChainId}`,
    });
  }

  checks.push(
    deps.hasWallet
      ? { name: "Wallet", status: "pass", detail: "wallet key present in env" }
      : { name: "Wallet", status: "warn", detail: "no wallet configured yet (fine for Stage 1)" },
  );

  return { checks, ok: checks.every((c) => c.status !== "fail") };
}

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: "✔",
  warn: "⚠",
  fail: "✖",
};

/** Render a {@link DoctorReport} as a human-readable checklist. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map((c) => `  ${STATUS_ICON[c.status]} ${c.name}: ${c.detail}`);
  const summary = report.ok
    ? "arcpayments doctor: all checks passed."
    : "arcpayments doctor: one or more checks FAILED.";
  return `arcpayments doctor\n${lines.join("\n")}\n\n${summary}\n`;
}

/** Detect the current runtime (Bun if present, otherwise Node). */
export function detectRuntime(): RuntimeInfo {
  const bunVersion = (process.versions as Record<string, string | undefined>).bun;
  if (bunVersion) {
    return { name: "bun", version: bunVersion };
  }
  return { name: "node", version: process.version };
}

/**
 * Build real dependencies (live RPC, current runtime, env) and run doctor.
 * Reads only a boolean for wallet presence — never the private key value.
 */
export async function runDoctorFromEnv(env: NetworkEnv = process.env): Promise<DoctorReport> {
  const config = loadNetworkConfig(env);
  const client = createArcPublicClient(config);
  return runDoctor({
    config,
    runtime: detectRuntime(),
    getRemoteChainId: () => client.getChainId(),
    hasWallet: Boolean(env.SELLER_PRIVATE_KEY?.trim() || env.BUYER_PRIVATE_KEY?.trim()),
  });
}
