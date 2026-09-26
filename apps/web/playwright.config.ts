import { defineConfig, devices } from "@playwright/test"
import { baseURL } from "./e2e/support/env"

// Browser suite. It needs a running API and SPA: `make e2e` targets the dev
// stack, CI boots its own. The setup project signs every role in once and
// the teardown project removes the e2e users afterwards.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "e2e/.report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  use: {
    baseURL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, teardown: "cleanup" },
    { name: "cleanup", testMatch: /auth\.teardown\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testMatch: /.*\.spec\.ts/,
    },
  ],
})
