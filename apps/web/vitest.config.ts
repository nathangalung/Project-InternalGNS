import path from "node:path"
import { defineConfig } from "vitest/config"

// Coverage tiers. Components and routes (.tsx) carry no line gate; the
// Playwright suite in e2e/ covers them.
const logicFiles = [
  "src/lib/!(useListScreen).ts",
  "src/components/shared/*.ts",
  "src/features/**/!(hooks|types|wizard-styles).ts",
]
const hookFiles = ["src/lib/useListScreen.ts", "src/hooks/*.ts", "src/features/**/hooks.ts"]

const hookTests = "src/**/*.hook.test.{ts,tsx}"

// Two projects: pure logic in node, hooks in happy-dom. No app plugins, so
// the run stays fast and isolated from the vite plugin chain.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "logic",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [hookTests],
        },
      },
      {
        extends: true,
        test: {
          name: "hooks",
          environment: "happy-dom",
          include: [hookTests],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: [...logicFiles, ...hookFiles],
      // .tsx is listed because v8 reports a component a logic test imports.
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.tsx", "src/test/**"],
      reporter: ["text", "html", "json-summary"],
      // No global thresholds: Vitest counts glob-matched files into them too.
      thresholds: Object.fromEntries([
        ...logicFiles.map((glob) => [glob, { statements: 98, branches: 95 }]),
        ...hookFiles.map((glob) => [glob, { statements: 90 }]),
      ]),
    },
  },
})
