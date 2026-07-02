import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { VERSION } from "../src/version";

describe("VERSION", () => {
  it("matches the version declared in package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("is a semver-shaped string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
