import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Fresh throwaway database, mock model, and immediate first reviews so the review UI is testable.
    command: `rm -rf data/e2e && next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PGLITE_DIR: "./data/e2e", LLM_PROVIDER: "mock", FIRST_REVIEW_DELAY_HOURS: "0" },
  },
});
