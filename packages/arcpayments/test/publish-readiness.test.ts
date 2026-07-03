import { describe, expect, it } from "vitest";
import pkg from "../package.json";

/**
 * Publish-hygiene guardrails (Stage 8). These assert the package METADATA is
 * publish-ready and the `files` allowlist can't drift to ship tests/src/secrets.
 * The actual tarball is verified out-of-band with `npm pack --dry-run` (see
 * docs/RELEASE.md); these keep the config honest in CI.
 */
describe("package.json is publish-ready", () => {
  it("is named arcpayments at a semver version", () => {
    expect(pkg.name).toBe("arcpayments");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has the required non-affiliation description prefix (the mitigation for the name)", () => {
    expect(
      pkg.description.startsWith(
        "Community toolkit for building on Arc (not affiliated with Circle/Arc) —",
      ),
    ).toBe(true);
  });

  it("declares bin, module exports, types, engines, repository, and MIT", () => {
    expect(pkg.bin.arcpayments).toBe("./dist/bin.js");
    expect(pkg.exports["."]).toMatchObject({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    });
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.license).toBe("MIT");
    expect(pkg.engines.node).toBe(">=20");
    expect(pkg.repository.url).toContain("github.com/gnanam1990/arcpayments");
    expect(pkg.keywords).toContain("arc");
  });

  it("ships dist + templates but NOT tests, src, or source maps", () => {
    const files = pkg.files;
    expect(files).toContain("templates");
    expect(files.some((f) => f.startsWith("dist"))).toBe(true);
    // no allowlist entry ships tests, raw src, or maps
    for (const f of files) {
      expect(f).not.toMatch(/(^|\/)test/);
      expect(f).not.toBe("src");
      expect(f).not.toMatch(/\.map$/);
    }
    // the dist entries are extension-scoped to js + d.ts (maps excluded even if emitted)
    expect(files).toContain("dist/**/*.js");
    expect(files).toContain("dist/**/*.d.ts");
  });

  it("runs the full gate on prepublishOnly (typecheck + lint + test + build)", () => {
    const pre = pkg.scripts.prepublishOnly;
    expect(pre).toContain("typecheck");
    expect(pre).toContain("lint");
    expect(pre).toContain("test");
    expect(pre).toContain("build");
  });
});
