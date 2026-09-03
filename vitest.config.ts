import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Node's own runner cannot load this source: it strips types rather than
 * transforming them, and the error classes use TypeScript parameter properties.
 * Rewriting 22 constructors across 15 files to suit a test runner would have
 * been the wrong place to make the change.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
