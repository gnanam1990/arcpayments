import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the `arcpayments` package to its SOURCE so app tests (and cross-package
// imports) run against current code without a prior build. At runtime/publish the
// package resolves to dist via its exports; this alias only affects vitest.
const arcpaymentsSrc = fileURLToPath(
  new URL("./packages/arcpayments/src/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      arcpayments: arcpaymentsSrc,
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    // Scaffolder templates are shipped verbatim to generated projects — they are not
    // part of THIS repo's test/lint/build surface (their `arcpayments` import resolves
    // to the published package, not our source).
    exclude: ["**/node_modules/**", "**/dist/**", "**/templates/**"],
    passWithNoTests: false,
  },
});
