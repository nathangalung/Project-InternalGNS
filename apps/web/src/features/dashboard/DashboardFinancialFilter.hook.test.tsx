import { afterEach, describe, expect, it, vi } from "vitest"
import { button, byRole, mount, press, unmount } from "@/test/dom"
import DashboardFinancialFilter, { YEAR_OPTIONS } from "./DashboardFinancialFilter"

afterEach(unmount)

function yearTrigger(): HTMLElement {
  const [trigger] = byRole("combobox", /^Pilih Tahun/)
  if (!trigger) throw new Error("no year trigger")
  return trigger
}

describe("DashboardFinancialFilter year select", () => {
  it("picks a year from the keyboard and applies it", async () => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    await mount(
      <DashboardFinancialFilter
        onClose={onClose}
        onApply={onApply}
        initialValues={{ year: YEAR_OPTIONS[0], month: null }}
      />,
    )
    const trigger = yearTrigger()
    expect(trigger.textContent).toContain(String(YEAR_OPTIONS[0]))

    trigger.focus()
    await press("ArrowDown")
    const options = byRole("option")
    expect(options.map((o) => o.textContent)).toEqual(YEAR_OPTIONS.map(String))
    expect(options[0].hasAttribute("data-selected")).toBe(true)

    await press("ArrowDown")
    await press("Enter")
    expect(yearTrigger().getAttribute("aria-expanded")).toBe("false")
    expect(yearTrigger().textContent).toContain(String(YEAR_OPTIONS[1]))

    button("Terapkan").click()
    expect(onApply).toHaveBeenCalledWith({ year: YEAR_OPTIONS[1], month: null })
  })

  it("closes only the list on Escape, keeping the modal open", async () => {
    const onClose = vi.fn()
    await mount(<DashboardFinancialFilter onClose={onClose} onApply={() => {}} />)
    yearTrigger().focus()
    await press("ArrowDown")
    expect(yearTrigger().getAttribute("aria-expanded")).toBe("true")

    await press("Escape")
    expect(yearTrigger().getAttribute("aria-expanded")).toBe("false")
    expect(onClose).not.toHaveBeenCalled()
    expect(byRole("dialog")).toHaveLength(1)
  })
})
