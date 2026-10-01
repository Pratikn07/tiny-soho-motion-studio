import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // Bound jsdom contention on high-core development machines; retain the tests' existing timeouts.
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
      "server-only": new URL("./tests/server-only.ts", import.meta.url).pathname,
    },
  },
});
