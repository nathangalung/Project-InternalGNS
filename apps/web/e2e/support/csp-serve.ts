import { join, normalize, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { sitePolicy } from "./csp"
import { apiURL, baseURL } from "./env"

// Serve dist under the policy.
//
// The built SPA, with the production content policy sent enforcing on every
// response, index fallback included. Nothing is proxied: the build must
// name the API origin in VITE_API_URL, as a release does. Run by
// playwright.csp.config.ts. Bun.serve rather than vite preview: under Bun,
// vite preview runs on the node:http layer, which crashed mid-suite with
// "write after end" and took every later test down with it.
const site = new URL(baseURL)
const { policy } = sitePolicy(new URL(apiURL).origin)
const dist = fileURLToPath(new URL("../../dist", import.meta.url))
const index = Bun.file(join(dist, "index.html"))

Bun.serve({
  hostname: site.hostname,
  port: Number(site.port),
  async fetch(req) {
    const path = normalize(join(dist, decodeURIComponent(new URL(req.url).pathname)))
    const file = Bun.file(path)
    // Routes, and anything outside dist, get the SPA shell.
    const found = path.startsWith(dist + sep) && (await file.exists())
    return new Response(found ? file : index, {
      headers: { "Content-Security-Policy": policy },
    })
  },
})
console.log(`Serving ${dist} at ${site.origin}`)
console.log(`Content-Security-Policy: ${policy}`)
