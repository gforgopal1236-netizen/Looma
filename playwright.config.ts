import { defineConfig } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === "1" ? "chrome" : undefined,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env: {
      NEXT_TELEMETRY_DISABLED: "1"
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    url: baseURL
  }
});
