import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import base from "./vite.config";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      // e2e/ is Playwright's (npm run e2e), not Vitest's
      exclude: [...configDefaults.exclude, "e2e/**"],
      setupFiles: ["src/test/setup.ts"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/bindings/**", "src/test/**", "src/**/*.test.{ts,tsx}"],
        reporter: ["text-summary", "html", "lcov"],
      },
    },
  }),
);
