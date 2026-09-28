import { readFileSync } from "node:fs"
import type { BrowserContext, Page } from "@playwright/test"

// Production content policy.
//
// Read from the web router's label in compose.prod.yml, so the policy the
// suite runs under is the one production serves. The one substitution is
// the API origin: production names https://${API_HOST}, a local run names
// the API it talks to.
export type SitePolicy = { policy: string; enforced: boolean }

const composeFile = new URL("../../../../compose.prod.yml", import.meta.url)
const label =
  /headers\.customResponseHeaders\.(Content-Security-Policy(?:-Report-Only)?)=([^"\n]+)"/g
// biome-ignore lint/suspicious/noTemplateCurlyInString: the compose placeholder, verbatim
const apiSource = "https://${API_HOST}"

export function sitePolicy(apiOrigin: string): SitePolicy {
  const found = [...readFileSync(composeFile, "utf8").matchAll(label)]
  if (found.length !== 1) {
    throw new Error(`compose.prod.yml sets ${found.length} content policies, expected one`)
  }
  const [, key, value] = found[0]
  if (value.split(apiSource).length !== 2) {
    throw new Error(`the content policy must name ${apiSource} once in connect-src`)
  }
  return {
    policy: value.replace(apiSource, apiOrigin),
    enforced: key === "Content-Security-Policy",
  }
}

// Violations seen this test.
//
// One list per worker process; tests in a worker run one at a time, and the
// fixture drains it after each.
const seen: string[] = []

export function violations(): readonly string[] {
  return seen
}

export function takeViolations(): string[] {
  return seen.splice(0)
}

type Reporter = { __reportCsp?: (line: string) => void }

// Records every violation in a context.
//
// The DOM event carries the directive and source; the console line also
// catches a refusal made before the init script ran.
export async function guardCsp(context: BrowserContext): Promise<void> {
  await context.exposeBinding("__reportCsp", ({ page }, line: string) => {
    seen.push(`${page.url()}: ${line}`)
  })
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const at = e.sourceFile ? ` at ${e.sourceFile}:${e.lineNumber}` : ""
      const sample = e.sample ? ` (${e.sample})` : ""
      ;(window as Reporter).__reportCsp?.(
        `${e.effectiveDirective} refused ${e.blockedURI || "inline"}${at}${sample}`,
      )
    })
  })
  const watch = (page: Page) =>
    page.on("console", (msg) => {
      if (/Content.Security.Policy/i.test(msg.text())) seen.push(`${page.url()}: ${msg.text()}`)
    })
  for (const page of context.pages()) watch(page)
  context.on("page", watch)
}
