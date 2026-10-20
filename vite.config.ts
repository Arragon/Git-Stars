import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: "hidden",
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "server/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
    setupFiles: ["src/data/__tests__/setup.ts"],
    // M7-01 (INH-1697): the suite must pass in a clean environment with no developer
    // .env, real OAuth app or provider secrets. These are test-only values; production
    // startup keeps requiring a real SESSION_SECRET (server/env.ts). dotenv never
    // overrides an already-set variable, so these win over a local .env as well.
    env: {
      NODE_ENV: "test",
      SESSION_SECRET: "test-secret-key-for-testing",
      DATABASE_PATH: ":memory:",
    },
    // Dynamic `import()` of route modules re-transforms their dependency graph under
    // parallel workers; the default 5s can be exceeded on slower machines/CI runners
    // even though the test bodies themselves run in <1s.
    testTimeout: 15000,
  },
});
