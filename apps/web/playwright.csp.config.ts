import { defineConfig } from "@playwright/test"
import { apiURL, baseURL } from "./e2e/support/env"
import base from "./playwright.config"

// Whole suite under production CSP.
//
// Builds the SPA against the API origin, serves dist with the enforcing
// policy from compose.prod.yml, and runs every spec; the fixtures fail a
// test on any violation. E2E_BASE_URL is the preview origin and E2E_API_URL
// the API, which must list that origin in CORS_ALLOWED_ORIGINS.
export default defineConfig({
  ...base,
  webServer: {
    command: "bun run build && bun e2e/support/csp-serve.ts",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    env: { VITE_API_URL: apiURL },
  },
})
