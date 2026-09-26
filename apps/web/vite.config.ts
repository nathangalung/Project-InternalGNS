import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import path from "node:path"
import { visualizer } from "rollup-plugin-visualizer"

const plugins = [
  tanstackRouter({
    target: "react",
    routesDirectory: "./src/routes",
    generatedRouteTree: "./src/routeTree.gen.ts",
    autoCodeSplitting: true,
  }),
  react(),
  tailwindcss(),
]

if (process.env.ANALYZE === "true") {
  plugins.push(visualizer({ open: true, gzipSize: true, brotliSize: true }))
}

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    // Playwright writes traces and auth state under e2e while `make e2e`
    // drives this server, and `bun run coverage` writes an HTML report per
    // file; watching either reloaded every open page mid-test.
    watch: {
      ignored: ["**/e2e/.results/**", "**/e2e/.report/**", "**/e2e/.auth/**", "**/coverage/**"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // Groups pull in their dependencies, as manualChunks did.
        codeSplitting: {
          groups: [
            {
              name: "tanstack-vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|@tanstack[\\/]react-query|@tanstack[\\/]react-router)[\\/]/,
            },
          ],
        },
      },
    },
  },
})
