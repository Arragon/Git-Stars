// M8-10: real-browser + accessibility gate. Runs against the production build with a
// deterministic seeded database and dev login, so journeys are reproducible.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command:
      "node scripts/e2e-reset.mjs && tsx scripts/e2e-seed.ts && npm start",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      SESSION_SECRET: "e2e-only-not-a-real-secret",
      LOCAL_DEV_USER: "e2e",
      ALLOW_DEV_LOGIN: "true",
      DATABASE_PATH: "./tmp/e2e.db",
      PORT: String(PORT),
      PUBLIC_URL: BASE_URL,
    },
  },
});
