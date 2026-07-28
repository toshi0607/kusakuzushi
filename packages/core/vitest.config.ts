import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `pnpm build` (tsc -p .) compiles the tests into dist/ as well, and vitest
    // would otherwise collect those copies too — the suite silently doubles
    // (58 -> 116 tests) depending on whether the package happens to be built.
    // Pin collection to the TypeScript sources.
    include: ["src/**/*.test.ts"],
  },
});
