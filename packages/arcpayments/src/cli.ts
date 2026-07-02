import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address, Hex } from "viem";
import { formatDoctorReport, runDoctorFromEnv } from "./doctor";
import { faucetCheck, formatFaucetInstructions } from "./faucet";
import { formatGatewayBalances, runGatewayBalance } from "./gateway-balance";
import { formatGatewayDepositReport, runGatewayDeposit } from "./gateway-deposit";
import { type NetworkEnv, loadNetworkConfig } from "./network";
import { createGatewayBalanceReader, createGatewayDepositor } from "./paywall-gateway";
import { runAddPaywall } from "./paywall-generator";
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
  gateway:deposit <amount>  Deposit buyer USDC into Circle Gateway (needs BUYER_PRIVATE_KEY)
  gateway:balance [addr]    Show Circle Gateway balance (deposited vs available)
  add paywall <name>        Scaffold an x402-gated tool (--price, --out, --force)

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

  if (command === "gateway:deposit") {
    return gatewayDeposit(rest, env);
  }

  if (command === "gateway:balance") {
    return gatewayBalance(rest, env);
  }

  if (command === "add" && rest[0] === "paywall") {
    return addPaywall(rest.slice(1));
  }

  return {
    code: 1,
    stdout: "",
    stderr: `arcpayments: unknown command "${command}"\nRun \`arcpayments --help\` to see available commands.\n`,
  };
}

/** Parse `--flag value` returning the value, or undefined. */
function flagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
}

/** Positional args: skip flags and the values that follow value-taking flags. */
function positionals(argv: string[], valueFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      if (valueFlags.includes(arg)) i++; // skip its value
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** `arcpayments add paywall <name> [--price $x] [--out path] [--force]`. */
function addPaywall(argv: string[]): CliResult {
  const name = positionals(argv, ["--price", "--out"])[0];
  if (!name) {
    return {
      code: 1,
      stdout: "",
      stderr: "add paywall requires a <name>, e.g. `arcpayments add paywall premium`\n",
    };
  }
  const price = flagValue(argv, "--price") ?? "$0.001";
  const outPath =
    flagValue(argv, "--out") ?? join(process.cwd(), "src", "tools", `${name}.paywall.ts`);
  const result = runAddPaywall({
    name,
    price,
    outPath,
    force: argv.includes("--force"),
    fileExists: existsSync,
    writeFile: (path, contents) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    },
  });
  return result.ok
    ? {
        code: 0,
        stdout: `Scaffolded paid tool "${name}" (${price}) → ${result.outPath}\n`,
        stderr: "",
      }
    : { code: 1, stdout: "", stderr: `${result.error}\n` };
}

/** `arcpayments wallet:new [--force]` — generate keys into a gitignored `.env`. */
function walletNew(argv: string[]): CliResult {
  const force = argv.includes("--force");
  const deps = createWalletNewDeps({ cwd: process.cwd(), force });
  const result = runWalletNew(deps);
  const text = formatWalletNewResult(result);
  return result.ok ? { code: 0, stdout: text, stderr: "" } : { code: 1, stdout: "", stderr: text };
}

/**
 * `arcpayments gateway:deposit <amount>` — deposit the buyer's USDC into Circle
 * Gateway so the x402 loop can settle. Reads BUYER_PRIVATE_KEY from env (never
 * logged). This is an on-chain action; endpoints/chain come from the network module.
 */
async function gatewayDeposit(argv: string[], env: NetworkEnv): Promise<CliResult> {
  const amount = argv.find((a) => !a.startsWith("--"));
  if (!amount) {
    return {
      code: 1,
      stdout: "",
      stderr: "gateway:deposit requires an <amount>, e.g. `arcpayments gateway:deposit 10`\n",
    };
  }
  const privateKey = env.BUYER_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return {
      code: 1,
      stdout: "",
      stderr: "gateway:deposit needs BUYER_PRIVATE_KEY set (the wallet whose USDC is deposited).\n",
    };
  }
  const net = loadNetworkConfig(env);
  const depositor = createGatewayDepositor({
    privateKey: privateKey as Hex,
    chain: net.gatewayChainName,
    rpcUrl: net.rpcUrl,
  });
  const report = await runGatewayDeposit(depositor, amount);
  const text = formatGatewayDepositReport(report);
  return report.ok ? { code: 0, stdout: text, stderr: "" } : { code: 1, stdout: "", stderr: text };
}

/**
 * `arcpayments gateway:balance [address]` — show the Circle Gateway balance
 * (deposited vs available) via the same `GatewayClient` as `gateway:deposit`.
 * Needs BUYER_PRIVATE_KEY to construct the client (never logged); reads any address.
 */
async function gatewayBalance(argv: string[], env: NetworkEnv): Promise<CliResult> {
  const address = argv.find((a) => !a.startsWith("--"));
  const privateKey = env.BUYER_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return {
      code: 1,
      stdout: "",
      stderr: "gateway:balance needs BUYER_PRIVATE_KEY set (used to reach Circle Gateway).\n",
    };
  }
  const net = loadNetworkConfig(env);
  const reader = createGatewayBalanceReader({
    privateKey: privateKey as Hex,
    chain: net.gatewayChainName,
    rpcUrl: net.rpcUrl,
  });
  const report = await runGatewayBalance(reader, address);
  const text = formatGatewayBalances(report);
  return report.ok ? { code: 0, stdout: text, stderr: "" } : { code: 1, stdout: "", stderr: text };
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
