import { describe, expect, it } from "vitest"
import { clampSlide, filesToAdd, nearSlides, slideFromScroll } from "./gallery"

describe("clampSlide", () => {
  it.each([
    [0, 3, 0],
    [2, 3, 2],
    [3, 3, 2],
    [-1, 3, 0],
    [5, 0, 0],
  ])("slide %i of %i is %i", (index, count, want) => {
    expect(clampSlide(index, count)).toBe(want)
  })
})

describe("slideFromScroll", () => {
  it.each([
    { name: "first", left: 0, width: 300, count: 3, want: 0 },
    { name: "past half rounds up", left: 160, width: 300, count: 3, want: 1 },
    { name: "before half stays", left: 140, width: 300, count: 3, want: 0 },
    { name: "overscroll clamps", left: 1200, width: 300, count: 3, want: 2 },
    { name: "no width yet", left: 50, width: 0, count: 3, want: 0 },
  ])("$name", ({ left, width, count, want }) => {
    expect(slideFromScroll(left, width, count)).toBe(want)
  })
})

describe("nearSlides", () => {
  it.each([
    { current: 0, count: 1, want: [0] },
    { current: 0, count: 5, want: [0, 1, 4] },
    { current: 2, count: 5, want: [1, 2, 3] },
    { current: 4, count: 5, want: [0, 3, 4] },
    { current: 0, count: 0, want: [] },
  ])("around $current of $count", ({ current, count, want }) => {
    expect([...nearSlides(current, count)].sort((a, b) => a - b)).toEqual(want)
  })
})

describe("filesToAdd", () => {
  const files = (n: number) => Array.from({ length: n }, (_, i) => new File(["x"], `f${i}.png`))

  it.each([
    { name: "all fit", picked: 2, have: 3, take: 2, skipped: 0 },
    { name: "fills the rest", picked: 4, have: 6, take: 2, skipped: 2 },
    { name: "full gallery", picked: 1, have: 8, take: 0, skipped: 1 },
    { name: "nothing picked", picked: 0, have: 0, take: 0, skipped: 0 },
  ])("$name", ({ picked, have, take, skipped }) => {
    const out = filesToAdd(files(picked), have, 8)
    expect(out.take.map((f) => f.name)).toEqual(
      files(picked)
        .slice(0, take)
        .map((f) => f.name),
    )
    expect(out.skipped).toBe(skipped)
  })
})
