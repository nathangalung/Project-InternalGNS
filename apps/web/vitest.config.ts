import path from "node:path"
import { defineConfig } from "vitest/config"

// Pure-logic unit tests. No DOM plugins — keeps the run fast and isolated
// from the app's vite plugin chain.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
