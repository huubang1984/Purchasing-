import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@trustprocure": fileURLToPath(new URL("./packages", import.meta.url)),
    },
  },
  test: {
    include: [
      "tests/**/*.test.ts",
      "packages/**/*.test.ts",
      "tools/**/*.test.ts",
      "db/**/*.test.ts",
    ],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 180000,
  },
});
