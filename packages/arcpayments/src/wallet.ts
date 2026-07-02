import type { Account, Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { NetworkEnv } from "./network";

/**
 * The wallet **seam**. Callers depend on this interface, never on a concrete
 * backend, so a `CircleWallet` (`@circle-fin/developer-controlled-wallets`) can be
 * dropped in later without touching them. Stage 2 ships only {@link LocalWallet}.
 */
export interface Wallet {
  /** The account's public 0x address. */
  getAddress(): Address;
  /** The underlying viem account (signer). Never exposes the raw private key. */
  getAccount(): Account;
}

/** A self-custodial local keypair wallet — right for a testnet demo. */
export class LocalWallet implements Wallet {
  private readonly account: Account;

  private constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
  }

  getAddress(): Address {
    return this.account.address;
  }

  getAccount(): Account {
    return this.account;
  }

  /** Wrap an existing private key (e.g. loaded from a gitignored `.env`). */
  static fromPrivateKey(privateKey: Hex): LocalWallet {
    return new LocalWallet(privateKey);
  }

  /** Generate a fresh keypair. The caller owns persisting the returned key safely. */
  static generate(): { wallet: LocalWallet; privateKey: Hex } {
    const privateKey = generatePrivateKey();
    return { wallet: new LocalWallet(privateKey), privateKey };
  }
}

/** Which env var holds each role's private key. Canonical across the codebase. */
export const WALLET_ENV_KEYS = {
  buyer: "BUYER_PRIVATE_KEY",
  seller: "SELLER_PRIVATE_KEY",
} as const satisfies Record<Role, string>;

/** The two wallet roles metered-mcp needs. */
export type Role = "buyer" | "seller";

const ROLES: readonly Role[] = ["buyer", "seller"];

/**
 * Reduce any secret to a short, safe reference — at most the last 4 characters.
 * Use this anywhere a key might otherwise reach a log, snapshot, or terminal.
 */
export function redactSecret(secret: string): string {
  return `…${secret.slice(-4)}`;
}

/** Parse `KEY=value` lines from a dotenv-style string. Ignores comments/blanks. */
export function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Strip inline comments on unquoted values (e.g. `KEY=v   # note`).
    const hash = value.indexOf(" #");
    if (hash >= 0) value = value.slice(0, hash).trim();
    out[key] = value;
  }
  return out;
}

/**
 * Insert or replace the given `KEY=value` pairs in a dotenv string, preserving
 * every other line (comments included). Appends keys that don't yet exist.
 */
export function upsertEnvVars(contents: string, updates: Record<string, string>): string {
  const remaining = new Map(Object.entries(updates));
  const lines = contents === "" ? [] : contents.replace(/\n$/, "").split("\n");

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;
    const key = trimmed.slice(0, eq).trim();
    if (remaining.has(key)) {
      const value = remaining.get(key);
      remaining.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });

  for (const [key, value] of remaining) {
    nextLines.push(`${key}=${value}`);
  }

  return `${nextLines.join("\n")}\n`;
}

/** Injectable IO for {@link runWalletNew} — keeps the core pure and testable. */
export interface WalletNewDeps {
  /** Target env file (absolute path). */
  envPath: string;
  /** Overwrite existing keys instead of keeping them. */
  force: boolean;
  /** Source of new private keys (viem in prod, fixed in tests). */
  generatePrivateKey: () => Hex;
  /** Read the env file, or null if it does not exist. */
  readEnvFile: (path: string) => string | null;
  /** Persist the merged env file (implementation must chmod 0600). */
  writeEnvFile: (path: string, contents: string) => void;
  /** Whether the env file is covered by .gitignore. */
  isEnvGitIgnored: (path: string) => boolean;
}

/** Per-role outcome. Contains only a REDACTED key reference — never the full key. */
export interface WalletRoleResult {
  role: Role;
  envKey: string;
  address: Address;
  action: "created" | "kept" | "overwritten";
  /** e.g. "…3b6f" — safe to print. The full key lives only in the env file. */
  redactedKey: string;
}

export interface WalletNewResult {
  ok: boolean;
  error?: string;
  envPath?: string;
  roles: WalletRoleResult[];
}

/**
 * Generate/persist buyer + seller keys, safely.
 *
 * Safety guarantees:
 * - aborts if the env file is not gitignored (never risks committing a key);
 * - keeps existing keys unless `force` is set (no silent overwrite);
 * - the returned result and any formatting contain only redacted key refs.
 */
export function runWalletNew(deps: WalletNewDeps): WalletNewResult {
  if (!deps.isEnvGitIgnored(deps.envPath)) {
    return {
      ok: false,
      error: `${deps.envPath} is not gitignored — refusing to write private keys. Add ".env" to .gitignore first.`,
      roles: [],
    };
  }

  const existingContents = deps.readEnvFile(deps.envPath) ?? "";
  const existing = parseEnv(existingContents);

  const roles: WalletRoleResult[] = [];
  const updates: Record<string, string> = {};

  for (const role of ROLES) {
    const envKey = WALLET_ENV_KEYS[role];
    const existingKey = existing[envKey]?.trim();

    let key: Hex;
    let action: WalletRoleResult["action"];
    if (existingKey && !deps.force) {
      key = existingKey as Hex;
      action = "kept";
    } else {
      key = deps.generatePrivateKey();
      action = existingKey ? "overwritten" : "created";
      updates[envKey] = key;
    }

    roles.push({
      role,
      envKey,
      address: privateKeyToAccount(key).address,
      action,
      redactedKey: redactSecret(key),
    });
  }

  if (Object.keys(updates).length > 0) {
    deps.writeEnvFile(deps.envPath, upsertEnvVars(existingContents, updates));
  }

  return { ok: true, envPath: deps.envPath, roles };
}

/** A role paired with its derived public address. */
export interface RoleAddress {
  role: Role;
  address: Address;
}

/**
 * Derive the public address for each role whose private key is present in env.
 * Used to tell the user which addresses to fund. Never returns key material.
 */
export function walletTargetsFromEnv(env: NetworkEnv): RoleAddress[] {
  const targets: RoleAddress[] = [];
  for (const role of ROLES) {
    const key = env[WALLET_ENV_KEYS[role]]?.trim();
    if (key) {
      targets.push({ role, address: privateKeyToAccount(key as Hex).address });
    }
  }
  return targets;
}

/** Human-readable summary of a wallet:new run. Contains no full private keys. */
export function formatWalletNewResult(result: WalletNewResult): string {
  if (!result.ok) {
    return `wallet:new aborted: ${result.error ?? "unknown error"}\n`;
  }

  const lines = result.roles.map(
    (r) => `  ${r.role.padEnd(6)} ${r.address}  (${r.envKey}=${r.redactedKey}, ${r.action})`,
  );
  const anyWritten = result.roles.some((r) => r.action !== "kept");
  const footer = anyWritten
    ? `Keys written to ${result.envPath} (gitignored). Fund them: arcpayments faucet`
    : `Existing keys kept (${result.envPath}). Re-run with --force to regenerate.`;

  return `wallet:new — buyer & seller identities\n${lines.join("\n")}\n\n${footer}\n`;
}
