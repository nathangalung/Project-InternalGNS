import { describe, expect, it } from "vitest"
import { chip, dropdownLabel, pill, presetChip, ui } from "./ui"

const toggles = { pill, chip, presetChip, dropdownLabel }

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
    expect(fn(true).split(/\s+/)).toContain(cls)
    expect(fn(false).split(/\s+/)).not.toContain(cls)
  })

  it.each([
    ["pill", pill],
    ["chip", chip],
    ["presetChip", presetChip],
  ] as const)("%s keeps the keyboard focus ring in both states", (_name, fn) => {
    expect(fn(true)).toContain(ui.focusRing)
    expect(fn(false)).toContain(ui.focusRing)
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
    expect(ui[key]).toContain(ui.focusRing)
  })

  it("gives menu rows the inset ring so it is not clipped", () => {
    expect(ui.dropdownItem).toContain(ui.focusRingInset)
    expect(ui.statusOption).toContain(ui.focusRingInset)
  })

  it("uses a ring on the dark sidebar that differs from the light one", () => {
    expect(ui.focusRingDark).toContain("ring-primary-400")
    expect(ui.focusRing).toContain("ring-primary-600")
  })
})
