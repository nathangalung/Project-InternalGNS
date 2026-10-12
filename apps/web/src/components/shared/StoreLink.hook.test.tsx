import { afterEach, describe, expect, it } from "vitest"
import { mount, unmount } from "@/test/dom"
import StoreLink from "./StoreLink"

afterEach(unmount)

const anchor = () => document.querySelector("a")

describe("StoreLink", () => {
  it("names a product link by its host", async () => {
    await mount(<StoreLink url="https://www.tokopedia.com/maju/tali" />)
    expect(anchor()?.getAttribute("aria-label")).toBe("Buka produk di tokopedia.com di tab baru")
    expect(anchor()?.getAttribute("target")).toBe("_blank")
    expect(anchor()?.getAttribute("rel")).toBe("noopener noreferrer")
    expect(document.body.textContent).toBe("tokopedia.com")
  })

  it("names a vendor's store and can say what it is", async () => {
    await mount(<StoreLink kind="store" labeled url="https://shopee.co.id/maju" />)
    expect(anchor()?.getAttribute("aria-label")).toBe("Buka toko shopee.co.id di tab baru")
    expect(document.body.textContent).toBe("Link Tokoshopee.co.id")
  })

  it("labels a product link when asked", async () => {
    await mount(<StoreLink labeled url="https://shopee.co.id/maju/tali" />)
    expect(document.body.textContent).toBe("Link Produkshopee.co.id")
  })

  it("renders the fallback for a missing or unsafe link", async () => {
    await mount(<StoreLink kind="store" labeled url="javascript:alert(1)" fallback="-" />)
    expect(anchor()).toBeNull()
    expect(document.body.textContent).toBe("-")
  })
})
