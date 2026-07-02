import type { Address } from "viem";
import { formatDoctorReport, runDoctorFromEnv } from "./doctor";
import { faucetCheck, formatFaucetInstructions } from "./faucet";
import { type NetworkEnv, loadNetworkConfig } from "./network";
import { VERSION } from "./version";
import { formatWalletNewResult, runWalletNew, walletTargetsFromEnv } from "./wallet";
import { createWalletNewDeps } from "./wallet-node";

/** Result of a CLI invocation. Pure data so it is trivial to unit-test. */
export interface CliResult {
  /** Process exit code. 0 = success. */
  code: number;
  /** Text destined for stdout. */
  stdout: string;
  /** Text destined for stderr. */
  stderr: string;
}

const HELP = `arcpayments v${VERSION}
Agentic-commerce tooling for Arc — wallets, x402 paywalls, Gateway nanopayment
batching, cross-chain withdrawal, and spend guards, wired for you.

Usage:
  arcpayments <command> [options]

Commands:
  doctor                    Diagnose your Arc setup (runtime, RPC, chain ID, wallet)
  wallet:new [--force]      Generate buyer + seller keys into a gitignored .env
  faucet [--check <addr>]   Print faucet URL + addresses, or check a balance

Options:
  -h, --help                Show this help
  -v, --version             Print the version

Community project for the Arc ecosystem. Not affiliated with Circle/Arc.
Testnet only — all USDC is test-value. Never commit .env or private keys.
`;

/**
 * Run the `arcpayments` CLI against the given argument list.
 *
 * @param argv arguments after the executable + script (i.e. `process.argv.slice(2)`).
 * @param env  environment to read config/wallet presence from (injectable for tests).
 * @returns exit code plus captured stdout/stderr — no side effects on the terminal,
 *          so callers (and tests) decide how to surface it.
 */
export async function run(argv: string[], env: NetworkEnv = process.env): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    return { code: 0, stdout: HELP, stderr: "" };
  }

  if (command === "--version" || command === "-v") {
    return { code: 0, stdout: `${VERSION}\n`, stderr: "" };
  }

  if (command === "doctor") {
    const report = await runDoctorFromEnv(env);
    return { code: report.ok ? 0 : 1, stdout: formatDoctorReport(report), stderr: "" };
  }

  if (command === "wallet:new") {
    return walletNew(rest);
  }

  if (command === "faucet") {
    return faucet(rest, env);
  }

  return {
    code: 1,
    stdout: "",
    stderr: `arcpayments: unknown command "${command}"\nRun \`arcpayments --help\` to see available commands.\n`,
  };
}

/** `arcpayments wallet:new [--force]` — generate keys into a gitignored `.env`. */
function walletNew(argv: string[]): CliResult {
  const force = argv.includes("--force");
  const deps = createWalletNewDeps({ cwd: process.cwd(), force });
  const result = runWalletNew(deps);
  const text = formatWalletNewResult(result);
  return result.ok ? { code: 0, stdout: text, stderr: "" } : { code: 1, stdout: "", stderr: text };
}

/** `arcpayments faucet [--check <address>]` — instructions or a balance check. */
async function faucet(argv: string[], env: NetworkEnv): Promise<CliResult> {
  const checkIdx = argv.indexOf("--check");
  if (checkIdx !== -1) {
    const address = argv[checkIdx + 1];
    if (!address) {
      return { code: 1, stdout: "", stderr: "faucet --check requires an address\n" };
    }
    const result = await faucetCheck(address as Address);
    const line = result.funded
      ? `✔ ${address} is funded — ${result.formatted} USDC (native)\n`
      : `✖ ${address} has no funds yet — ${result.formatted} USDC (native)\n`;
    return { code: result.funded ? 0 : 1, stdout: line, stderr: "" };
  }

  const config = loadNetworkConfig(env);
  const targets = walletTargetsFromEnv(env);
  return { code: 0, stdout: formatFaucetInstructions(config, targets), stderr: "" };
}
