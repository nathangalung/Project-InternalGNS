import { test as base } from "../fixtures"
import { SalesSeed } from "./sales"

export { expect } from "../fixtures"

// Per-test sales seed fixture.
//
// Everything a test seeds is cleaned up after it.
export const test = base.extend<{ seed: SalesSeed }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructured argument
  seed: async ({}, use) => {
    const seed = new SalesSeed()
    await use(seed)
    await seed.cleanup()
  },
})
