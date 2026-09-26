import { describe, expect, it } from "vitest"
import { legacyClasses } from "@/test/uiLegacyClasses"
import {
  button,
  chip,
  chipRecipe,
  dropdown,
  dropdownLabel,
  focusRing,
  pill,
  presetChip,
  ui,
} from "./ui"

const toggles = { pill, chip, presetChip, dropdownLabel }

// Class set, order-free.
function classSet(value: string): string[] {
  return [...new Set(value.split(/\s+/).filter(Boolean))].sort()
}

// Recipe output by legacy key.
function current(key: string): string {
  const call = /^(\w+)\((true|false)\)$/.exec(key)
  if (call) return toggles[call[1] as keyof typeof toggles](call[2] === "true")
  return ui[key as keyof typeof ui]
}

// Every class of `part` is present.
function containsAll(value: string, part: string): boolean {
  const have = new Set(classSet(value))
  return classSet(part).every((c) => have.has(c))
}

describe("ui recipe parity", () => {
  it("covers every legacy entry and nothing more", () => {
    const toggleKeys = Object.keys(toggles).flatMap((n) => [`${n}(true)`, `${n}(false)`])
    expect([...Object.keys(ui), ...toggleKeys].sort()).toEqual(Object.keys(legacyClasses).sort())
  })

  it.each(Object.entries(legacyClasses))("%s keeps its exact class set", (key, legacy) => {
    expect(classSet(current(key))).toEqual(classSet(legacy))
  })
})

describe("ui recipes", () => {
  it("lets a caller override replace the conflicting utility", () => {
    const out = classSet(button({ variant: "primary", class: "px-4" }))
    expect(out).toContain("px-4")
    expect(out).not.toContain("px-6")
  })

  it("keeps the custom type scale next to a text colour", () => {
    const out = classSet(chipRecipe({ class: "text-caption text-primary-700" }))
    expect(out).toEqual(expect.arrayContaining(["text-caption", "text-primary-700"]))
    expect(out).not.toContain("text-[13px]")
  })

  it("rejects an undeclared variant at the type level", () => {
    // @ts-expect-error "ghost" is not a button variant
    const out = button({ variant: "ghost" })
    expect(classSet(out)).toContain("border")
  })

  it("defaults the dropdown to its normal density and idle label", () => {
    const d = dropdown()
    expect(d.panel()).toBe(ui.dropdownPanel)
    expect(d.label()).toBe(dropdownLabel(false))
  })
})

describe("ui toggles", () => {
  it.each(Object.entries(toggles))("%s looks different when active", (_name, fn) => {
    expect(fn(true)).not.toBe(fn(false))
  })

  it.each([
    ["pill", pill, "bg-primary-600"],
    ["chip", chip, "border-primary-700"],
    ["presetChip", presetChip, "border-primary-700"],
    ["dropdownLabel", dropdownLabel, "text-primary-700"],
  ] as const)("%s marks the active state with the brand colour", (_name, fn, cls) => {
    expect(classSet(fn(true))).toContain(cls)
    expect(classSet(fn(false))).not.toContain(cls)
  })

  it.each([
    ["pill", pill],
    ["chip", chip],
    ["presetChip", presetChip],
  ] as const)("%s keeps the keyboard focus ring in both states", (_name, fn) => {
    expect(containsAll(fn(true), ui.focusRing)).toBe(true)
    expect(containsAll(fn(false), ui.focusRing)).toBe(true)
  })

  it.each([
    "btnPrimary",
    "btnOutline",
    "iconAction",
    "entityLink",
    "entityLinkMuted",
    "modalCancel",
    "modalSubmit",
    "breadcrumbLink",
    "statusTrigger",
  ] as const)("%s shows the focus ring on keyboard focus", (key) => {
    expect(containsAll(ui[key], ui.focusRing)).toBe(true)
  })

  it("gives menu rows the inset ring so it is not clipped", () => {
    expect(containsAll(ui.dropdownItem, ui.focusRingInset)).toBe(true)
    expect(containsAll(ui.statusOption, ui.focusRingInset)).toBe(true)
  })

  it("uses a ring on the dark sidebar that differs from the light one", () => {
    expect(classSet(focusRing({ tone: "dark" }))).toContain("focus-visible:ring-primary-400")
    expect(classSet(ui.focusRing)).toContain("focus-visible:ring-primary-600")
  })
})
