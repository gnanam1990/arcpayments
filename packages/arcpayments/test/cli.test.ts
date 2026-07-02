import { describe, expect, it } from "vitest";
import { run } from "../src/cli";
import { VERSION } from "../src/version";

describe("arcpayments --help", () => {
  it("exits 0 and prints usage including the doctor command", () => {
    const result = run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage");
    expect(result.stdout).toContain("arcpayments");
    expect(result.stdout).toContain("doctor");
  });

  it("treats -h and no args the same as --help (exit 0)", () => {
    expect(run(["-h"]).code).toBe(0);
    expect(run([]).code).toBe(0);
    expect(run([]).stdout).toContain("doctor");
  });
});

describe("arcpayments --version", () => {
  it("prints the package version and exits 0", () => {
    const result = run(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });
});

describe("arcpayments doctor (stub)", () => {
  it("exits 0 and reports that it is not implemented yet", () => {
    const result = run(["doctor"]);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("not implemented yet");
  });
});

describe("unknown command", () => {
  it("exits non-zero and points at --help", () => {
    const result = run(["definitely-not-a-command"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--help");
  });
});
