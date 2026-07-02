import { formatDoctorReport, runDoctorFromEnv } from "./doctor";
import type { NetworkEnv } from "./network";
import { VERSION } from "./version";

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
  doctor            Diagnose your Arc setup (runtime, RPC, chain ID, wallet)

Options:
  -h, --help        Show this help
  -v, --version     Print the version

Community project for the Arc ecosystem. Not affiliated with Circle/Arc.
Testnet only — all USDC is test-value.
`;

/**
 * Run the `arcpayments` CLI against the given argument list.
 *
 * @param argv arguments after the executable + script (i.e. `process.argv.slice(2)`).
 * @param env  environment to read config/wallet presence from (injectable for tests).
 * @returns exit code plus captured stdout/stderr — no side effects, so callers
 *          (and tests) decide how to surface it.
 */
export async function run(argv: string[], env: NetworkEnv = process.env): Promise<CliResult> {
  const [command] = argv;

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

  return {
    code: 1,
    stdout: "",
    stderr: `arcpayments: unknown command "${command}"\nRun \`arcpayments --help\` to see available commands.\n`,
  };
}
