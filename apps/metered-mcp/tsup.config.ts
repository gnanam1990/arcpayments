import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  // Bundle the MCP SDK so the built server runs standalone.
  noExternal: [/@modelcontextprotocol\/sdk/, /zod/],
});
