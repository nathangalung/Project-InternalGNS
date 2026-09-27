import { describe, expect, it } from "vitest"
import { cn, tv } from "./utils"

describe("cn", () => {
  it("returns an empty string for no classes", () => {
    expect(cn()).toBe("")
    expect(cn(false, null)).toBe("")
  })

  it("joins conditional classes and drops falsy ones", () => {
    expect(cn("a", false, null, undefined, { b: true, c: false }, ["d"])).toBe("a b d")
  })

  it("keeps the later of two conflicting utilities", () => {
    expect(cn("w-[672px] px-10", "w-[900px]")).toBe("px-10 w-[900px]")
  })

  it.each(["text-overline", "text-caption"])("treats %s as a size, not a colour", (size) => {
    expect(cn(size, "text-primary-600")).toBe(`${size} text-primary-600`)
    expect(cn("text-sm", size)).toBe(size)
  })

  it("keeps the Inter family next to a weight", () => {
    expect(cn("font-[Inter,sans-serif]", "font-bold")).toBe("font-[Inter,sans-serif] font-bold")
  })
})

describe("tv", () => {
  it("merges with the same theme rules as cn", () => {
    const heading = tv({ base: "text-overline text-dark-500" })
    expect(heading({ class: "text-primary-600" })).toBe("text-overline text-primary-600")
  })
})
