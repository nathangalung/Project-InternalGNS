import { describe, expect, it } from "vitest"
import { getPageNumbers, PAGE_SIZE_OPTIONS } from "./pagination"

describe("getPageNumbers", () => {
  it.each<[string, number, number, (number | null)[]]>([
    ["no pages", 1, 0, []],
    ["five pages show every number", 3, 5, [1, 2, 3, 4, 5]],
    ["start of a long list", 1, 10, [1, 2, null, 9, 10]],
    ["middle keeps both neighbours", 5, 10, [1, 2, null, 4, 5, 6, null, 9, 10]],
    ["near the start joins the head", 3, 10, [1, 2, 3, 4, null, 9, 10]],
    ["end of a long list", 10, 10, [1, 2, null, 9, 10]],
    ["near the end joins the tail", 8, 10, [1, 2, null, 7, 8, 9, 10]],
    ["six pages leave no one-page gap", 4, 6, [1, 2, 3, 4, 5, 6]],
  ])("%s", (_name, current, total, want) => {
    expect(getPageNumbers(current, total)).toEqual(want)
  })

  it("never emits a page outside 1..total or a doubled ellipsis", () => {
    for (let total = 6; total <= 30; total++) {
      for (let current = 1; current <= total; current++) {
        const pages = getPageNumbers(current, total)
        const nums = pages.filter((p): p is number => p !== null)
        expect(nums.every((n) => n >= 1 && n <= total)).toBe(true)
        expect(nums).toContain(current)
        expect(pages.some((p, i) => p === null && pages[i + 1] === null)).toBe(false)
      }
    }
  })

  it("offers the row sizes the list footer shows", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([5, 10, 15])
  })
})
