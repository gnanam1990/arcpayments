import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  target: "node20",
  dts: true,
  clean: true,
  // No source maps in the published tarball (keeps `src` off npm; nothing at runtime needs them).
  sourcemap: false,
  // bin.ts declares its own shebang; keep it in the emitted output.
  banner: {},
});
