import pkg from "../package.json";

/**
 * The published version of the `arcpayments` CLI/library.
 *
 * Sourced from this package's own package.json so the CLI can never report a
 * version that drifts from what npm sees. Bundled in at build time by tsup.
 */
export const VERSION: string = pkg.version;
