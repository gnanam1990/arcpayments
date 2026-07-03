import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `arcpayments create <name>` — scaffold a working, testnet-wired starter project.
 *
 * Pure core: the manifest + rendering + name validation are decision logic; the CLI
 * supplies the real filesystem. Template files live in `templates/starter/` (shipped
 * in the package) and are copied/rendered on create, with `__APP_NAME__` substituted.
 */

export const APP_NAME_TOKEN = "__APP_NAME__";

export interface StarterManifestEntry {
  /** Path within `templates/starter/`. Dotfiles are stored un-dotted (npm strips `.gitignore`). */
  template: string;
  /** Path within the generated project. */
  out: string;
  /** Whether to substitute `__APP_NAME__`. */
  render: boolean;
}

/** The starter file tree. Order is stable so generation is deterministic. */
export const STARTER_MANIFEST: readonly StarterManifestEntry[] = [
  { template: "package.json", out: "package.json", render: true },
  { template: "tsconfig.json", out: "tsconfig.json", render: false },
  { template: "gitignore", out: ".gitignore", render: false },
  { template: "env.example", out: ".env.example", render: false },
  { template: "README.md", out: "README.md", render: true },
  { template: "src/server.ts", out: "src/server.ts", render: true },
  { template: "src/buyer.ts", out: "src/buyer.ts", render: false },
  { template: "src/index.ts", out: "src/index.ts", render: true },
  { template: "test/server.test.ts", out: "test/server.test.ts", render: false },
];

/** Absolute path to the bundled `templates/starter` dir (works from src and from dist). */
export function starterTemplatesDir(): string {
  return fileURLToPath(new URL("../templates/starter", import.meta.url));
}

/** Substitute the app-name token. */
export function renderTemplate(contents: string, appName: string): string {
  return contents.split(APP_NAME_TOKEN).join(appName);
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export type NameCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate the project name: npm-safe, and NOT impersonating Circle/Arc (the emitted
 * project is a community starter, so we refuse names that read as official tooling).
 */
export function validateAppName(name: string): NameCheck {
  const n = name.trim();
  if (!n) return { ok: false, error: "project name is required, e.g. `arcpayments create my-app`" };
  if (n.length > 100) return { ok: false, error: "project name is too long (max 100 chars)" };
  if (!NAME_RE.test(n)) {
    return {
      ok: false,
      error: `invalid project name "${name}" — use lowercase letters, digits, and - _ . (npm-safe)`,
    };
  }
  const lower = n.toLowerCase();
  if (lower === "arcpayments" || lower.includes("circle") || /(^|[-_.])arc([-_.]|$)/.test(lower)) {
    return {
      ok: false,
      error: `"${name}" could be mistaken for official Circle/Arc tooling — choose a distinct name (this is a community scaffolder).`,
    };
  }
  return { ok: true };
}

/** Injectable filesystem seams — keeps the core testable without touching disk. */
export interface CreateDeps {
  appName: string;
  /** Absolute path of the project directory to create. */
  targetDir: string;
  force: boolean;
  /** Read a template file (relative to `templates/starter`). */
  readTemplate: (relPath: string) => string;
  /** True when `targetDir` is missing or contains no entries. */
  targetIsEmpty: (dir: string) => boolean;
  /** Write a file, creating parent directories. */
  writeFile: (absPath: string, contents: string) => void;
}

export interface CreateResult {
  ok: boolean;
  error?: string;
  targetDir: string;
  /** Project-relative paths that were written. */
  files: string[];
}

/**
 * Scaffold the starter into `targetDir`. Refuses an invalid/impersonating name and
 * refuses a non-empty target unless `force`. Every emitted file comes from a template
 * — nothing is invented, and no key material is ever written.
 */
export function runCreate(deps: CreateDeps): CreateResult {
  const name = validateAppName(deps.appName);
  if (!name.ok) return { ok: false, error: name.error, targetDir: deps.targetDir, files: [] };

  if (!deps.force && !deps.targetIsEmpty(deps.targetDir)) {
    return {
      ok: false,
      error: `${deps.targetDir} is not empty — pass --force to scaffold into it.`,
      targetDir: deps.targetDir,
      files: [],
    };
  }

  const files: string[] = [];
  for (const entry of STARTER_MANIFEST) {
    const raw = deps.readTemplate(entry.template);
    const contents = entry.render ? renderTemplate(raw, deps.appName) : raw;
    deps.writeFile(join(deps.targetDir, entry.out), contents);
    files.push(entry.out);
  }
  return { ok: true, targetDir: deps.targetDir, files };
}
