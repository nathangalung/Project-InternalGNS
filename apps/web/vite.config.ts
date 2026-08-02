import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"
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
  plugins.push(visualizer({ open: true, gzipSize: true, brotliSize: true }) as never)
}

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "tanstack-vendor": [
            "react",
            "react-dom",
            "react-dom/client",
            "@tanstack/react-query",
            "@tanstack/react-router",
          ],
        },
      },
    },
  },
})
