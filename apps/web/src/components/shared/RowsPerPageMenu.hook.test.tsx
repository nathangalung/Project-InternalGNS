import { afterEach, describe, expect, it, vi } from "vitest"
import { byRole, click, mount, press, unmount } from "@/test/dom"
import RowsPerPageMenu from "./RowsPerPageMenu"

afterEach(unmount)

function trigger(): HTMLElement {
  const el = document.querySelector("main button")
  if (!(el instanceof HTMLButtonElement)) throw new Error("no trigger")
  return el
}

async function mountMenu(onChange = vi.fn()) {
  await mount(
    <RowsPerPageMenu value={10} options={[5, 10, 15]} onChange={onChange} triggerClassName="" />,
  )
  return onChange
}

describe("RowsPerPageMenu", () => {
  it("opens on click with the current size checked", async () => {
    await mountMenu()
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu")
    await click(trigger())
    const rows = byRole("menuitemradio")
    expect(rows.map((r) => r.textContent)).toEqual(["5 Baris", "10 Baris", "15 Baris"])
    expect(rows.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"])
  })

  it("picks a size from the keyboard and hands focus back", async () => {
    const onChange = await mountMenu()
    trigger().focus()
    await press("ArrowDown")
    expect(byRole("menu")).toHaveLength(1)
    await press("ArrowDown")
    await press("Enter")
    expect(onChange).toHaveBeenCalledWith(10)
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(trigger())
  })

  it("closes on Escape without a pick", async () => {
    const onChange = await mountMenu()
    trigger().focus()
    await press("ArrowDown")
    await press("Escape")
    expect(trigger().getAttribute("aria-expanded")).toBe("false")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("locks no scroll on the page while open", async () => {
    await mountMenu()
    await click(trigger())
    expect(document.documentElement.getAttribute("style")).toBeNull()
    expect(document.body.getAttribute("style")).toBeNull()
  })
})

describe("RowsPerPageMenu controlled", () => {
  it("reports open changes and follows the open prop", async () => {
    const onOpenChange = vi.fn()
    const menu = (open: boolean) => (
      <RowsPerPageMenu
        value={5}
        options={[5, 10]}
        onChange={() => {}}
        triggerClassName=""
        open={open}
        onOpenChange={onOpenChange}
      />
    )
    await mount(menu(false))
    await click(trigger())
    expect(onOpenChange).toHaveBeenLastCalledWith(true, expect.anything())
    expect(byRole("menu")).toHaveLength(0)

    await unmount()
    await mount(menu(true))
    expect(byRole("menuitemradio")).toHaveLength(2)
    await press("Escape", byRole("menu")[0])
    expect(onOpenChange).toHaveBeenLastCalledWith(false, expect.anything())
  })
})
