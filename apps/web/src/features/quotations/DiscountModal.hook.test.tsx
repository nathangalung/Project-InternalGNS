import { afterEach, describe, expect, it, vi } from "vitest"
import { button, click, mount, type, unmount } from "@/test/dom"
import DiscountModal from "./DiscountModal"

function field(): HTMLInputElement {
  const lbl = [...document.querySelectorAll("label")].find((l) =>
    l.textContent?.startsWith("Persentase Diskon"),
  )
  const el = document.getElementById(lbl?.htmlFor ?? "")
  if (!(el instanceof HTMLInputElement)) throw new Error("no discount field")
  return el
}

async function open(initialDiscount = 0) {
  const onSuccess = vi.fn()
  await mount(
    <DiscountModal
      open
      onOpenChange={vi.fn()}
      initialDiscount={initialDiscount}
      onSuccess={onSuccess}
    />,
  )
  return onSuccess
}

const save = () => button("Simpan Data") as HTMLButtonElement

afterEach(unmount)

describe("DiscountModal", () => {
  // A comma or a dot starts the decimals.
  it.each([
    ["2,5", 2.5],
    ["2.5", 2.5],
    ["10", 10],
    ["100,00", 100],
    ["", 0],
  ])("saves %j as %s", async (typed, saved) => {
    const onSuccess = await open()
    await type(field(), typed)
    await click(save())
    expect(onSuccess).toHaveBeenCalledWith(saved)
  })

  it.each(["101", "abc", "2,555"])("refuses %j on the field", async (typed) => {
    const onSuccess = await open()
    await type(field(), typed)
    expect(document.body.textContent).toContain("Diskon harus berupa angka antara 0 dan 100.")
    expect(field().getAttribute("aria-invalid")).toBe("true")
    expect(save().disabled).toBe(true)
    await click(save())
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("starts from the stored discount with a decimal comma", async () => {
    await open(2.5)
    expect(field().value).toBe("2,5")
  })
})
