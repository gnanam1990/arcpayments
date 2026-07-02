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
  doctor            Diagnose your Arc setup (RPC, chain ID, wallet, faucet balance)

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
 * @returns exit code plus captured stdout/stderr — no side effects, so callers
 *          (and tests) decide how to surface it.
 */
export function run(argv: string[]): CliResult {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    return { code: 0, stdout: HELP, stderr: "" };
  }

  if (command === "--version" || command === "-v") {
    return { code: 0, stdout: `${VERSION}\n`, stderr: "" };
  }

  if (command === "doctor") {
    return doctor(rest);
  }

  return {
    code: 1,
    stdout: "",
    stderr: `arcpayments: unknown command "${command}"\nRun \`arcpayments --help\` to see available commands.\n`,
  };
}

/**
 * `arcpayments doctor` — Stage 0 stub.
 *
 * Deliberately does no network / wallet work yet (that lands in Stage 1, reading
 * every endpoint from NETWORK.md / env — never hardcoded). Exits 0 so the stub is
 * a no-op in CI.
 */
function doctor(_argv: string[]): CliResult {
  return {
    code: 0,
    stdout: "arcpayments doctor: not implemented yet (stub — real checks arrive in Stage 1).\n",
    stderr: "",
  };
}
