import { fileURLToPath } from "node:url"
import { preview } from "vite"
import { sitePolicy } from "./csp"
import { apiURL, baseURL } from "./env"

// Serve dist under the policy.
//
// vite preview of the built SPA, with the production content policy sent
// enforcing on every response, index fallback included. No vite.config is
// loaded, so nothing is proxied: the build must name the API origin in
// VITE_API_URL, as a release does. Run by playwright.csp.config.ts.
const site = new URL(baseURL)
const { policy } = sitePolicy(new URL(apiURL).origin)

const server = await preview({
  configFile: false,
  root: fileURLToPath(new URL("../..", import.meta.url)),
  logLevel: "info",
  preview: {
    host: site.hostname,
    port: Number(site.port),
    strictPort: true,
    headers: { "Content-Security-Policy": policy },
  },
})
server.printUrls()
console.log(`Content-Security-Policy: ${policy}`)
