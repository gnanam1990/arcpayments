import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
import type { WalletNewDeps } from "./wallet";

/**
 * Is `path` ignored by git? Authoritative when a working git repo answers; falls
 * back to scanning `.gitignore` when git is unavailable or the dir isn't a repo.
 *
 * `git check-ignore -q` exits: 0 = ignored, 1 = NOT ignored, 128 = not a repo.
 */
export function isEnvGitIgnored(path: string, cwd: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd, stdio: "ignore" });
    return true; // exit 0 → ignored
  } catch (err) {
    const status = (err as { status?: number; code?: string }).status;
    if (status === 1) {
      return false; // git ran and says: NOT ignored
    }
    // git missing (ENOENT) or not a repo (128) → best-effort .gitignore scan
    return gitignoreMentionsEnv(cwd);
  }
}

function gitignoreMentionsEnv(cwd: string): boolean {
  const gitignorePath = join(cwd, ".gitignore");
  if (!existsSync(gitignorePath)) return false;
  return readFileSync(gitignorePath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .some((l) => l === ".env" || l === "/.env" || l === ".env*" || l === ".env.*");
}

/** Write a file with owner-only permissions (0600), enforced even if it existed. */
function writeSecure(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best effort — some filesystems (e.g. Windows) don't support chmod
  }
}

/** Build real filesystem/git-backed dependencies for {@link runWalletNew}. */
export function createWalletNewDeps(opts: { cwd: string; force: boolean }): WalletNewDeps {
  const envPath = join(opts.cwd, ".env");
  return {
    envPath,
    force: opts.force,
    generatePrivateKey,
    readEnvFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
    writeEnvFile: writeSecure,
    isEnvGitIgnored: (path) => isEnvGitIgnored(path, opts.cwd),
  };
}
