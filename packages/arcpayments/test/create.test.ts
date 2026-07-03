import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  APP_NAME_TOKEN,
  type CreateDeps,
  STARTER_MANIFEST,
  renderTemplate,
  runCreate,
  starterTemplatesDir,
  validateAppName,
} from "../src/create";

const TEMPLATES = starterTemplatesDir();
const realReadTemplate = (rel: string) => readFileSync(join(TEMPLATES, rel), "utf8");

/** Generate into an in-memory filesystem so tests never touch disk. */
function generate(appName: string, opts: Partial<CreateDeps> = {}) {
  const written = new Map<string, string>();
  const result = runCreate({
    appName,
    targetDir: "/out",
    force: false,
    readTemplate: realReadTemplate,
    targetIsEmpty: () => true,
    writeFile: (path, contents) => written.set(path, contents),
    ...opts,
  });
  return { result, written };
}

describe("validateAppName", () => {
  it("accepts npm-safe names", () => {
    expect(validateAppName("my-app").ok).toBe(true);
    expect(validateAppName("shop_2").ok).toBe(true);
  });

  it("rejects empty, unsafe, and impersonating names", () => {
    expect(validateAppName("").ok).toBe(false);
    expect(validateAppName("My App").ok).toBe(false); // spaces / caps
    expect(validateAppName("arcpayments").ok).toBe(false);
    expect(validateAppName("circle-pay").ok).toBe(false); // impersonation
    expect(validateAppName("arc-shop").ok).toBe(false); // 'arc' as a token
    // but a name that merely contains the letters is fine
    expect(validateAppName("marketplace").ok).toBe(true);
  });
});

describe("runCreate — file tree", () => {
  it("emits every manifest file with the app name rendered into package.json + README", () => {
    const { result, written } = generate("my-app");
    expect(result.ok).toBe(true);
    // exact tree
    expect(result.files.sort()).toEqual(
      [
        ".env.example",
        ".gitignore",
        "README.md",
        "package.json",
        "src/buyer.ts",
        "src/index.ts",
        "src/server.ts",
        "test/server.test.ts",
        "tsconfig.json",
      ].sort(),
    );
    // dotfiles are emitted dotted even though stored un-dotted
    expect(written.has("/out/.gitignore")).toBe(true);
    expect(written.has("/out/.env.example")).toBe(true);

    const pkg = JSON.parse(written.get("/out/package.json") ?? "{}");
    expect(pkg.name).toBe("my-app");
    expect(pkg.dependencies.arcpayments).toBeDefined();
    expect(written.get("/out/README.md")).toContain("# my-app");
  });

  it("leaves NO unresolved template tokens in any emitted file", () => {
    const { written } = generate("my-app");
    for (const [path, contents] of written) {
      expect(contents, `${path} still has a token`).not.toContain(APP_NAME_TOKEN);
    }
  });

  it("every address literal in the emitted templates is a VALID address (isAddress)", () => {
    // Guards against the class of bug where a template ships an invalid/bad-checksum
    // address, so the generated app's own tests throw at isAddress()/getAddress().
    const { written } = generate("my-app");
    const ADDRESS_RE = /0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;
    for (const [path, contents] of written) {
      for (const match of contents.match(ADDRESS_RE) ?? []) {
        expect(isAddress(match), `${path}: "${match}" is not a valid address`).toBe(true);
      }
    }
  });

  it("emits an empty .env.example — no key material in any template", () => {
    const { written } = generate("my-app");
    const env = written.get("/out/.env.example") ?? "";
    expect(env).toMatch(/SELLER_PRIVATE_KEY=\s*$/m); // present but empty
    expect(env).toMatch(/BUYER_PRIVATE_KEY=\s*$/m);
    // no 0x… private key anywhere in the generated tree
    for (const [path, contents] of written) {
      expect(contents, `${path} contains a 64-hex key`).not.toMatch(/0x[a-fA-F0-9]{64}/);
    }
  });

  it("the emitted README + package carry the non-affiliation line", () => {
    const { written } = generate("my-app");
    expect(written.get("/out/README.md")?.toLowerCase()).toContain("not affiliated with circle");
    const pkg = JSON.parse(written.get("/out/package.json") ?? "{}");
    expect(pkg.description.toLowerCase()).toContain("not affiliated with circle");
  });
});

describe("runCreate — safety rails", () => {
  it("refuses a non-empty target dir without --force", () => {
    const { result } = generate("my-app", { targetIsEmpty: () => false });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not empty|--force/);
  });

  it("scaffolds into a non-empty target WITH --force", () => {
    const { result } = generate("my-app", { targetIsEmpty: () => false, force: true });
    expect(result.ok).toBe(true);
  });

  it("refuses an impersonating name before writing anything", () => {
    const written = new Map<string, string>();
    const result = runCreate({
      appName: "circle-official",
      targetDir: "/out",
      force: true,
      readTemplate: realReadTemplate,
      targetIsEmpty: () => true,
      writeFile: (p, c) => written.set(p, c),
    });
    expect(result.ok).toBe(false);
    expect(written.size).toBe(0); // nothing written
  });
});

describe("template manifest integrity", () => {
  it("every manifest template resolves to a real file on disk", () => {
    for (const entry of STARTER_MANIFEST) {
      expect(() => realReadTemplate(entry.template), entry.template).not.toThrow();
    }
  });

  it("renderTemplate replaces all token occurrences", () => {
    expect(renderTemplate(`${APP_NAME_TOKEN}-${APP_NAME_TOKEN}`, "x")).toBe("x-x");
  });
});
