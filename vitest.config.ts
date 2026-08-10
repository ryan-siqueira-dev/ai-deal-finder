import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Process entrypoints are exercised by smoke/integration checks; the
      // unit-coverage gate focuses on reusable application code.
      include: ["src/**/*.ts"],
      exclude: ["src/cli/**", "src/index.ts"],
      thresholds: {
        statements: 45,
        branches: 65,
        functions: 60,
        lines: 45,
      },
    },
  },
});
