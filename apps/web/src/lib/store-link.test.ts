import { describe, expect, it } from "vitest"
import {
  PRODUCT_URL_ERROR,
  productUrlError,
  STORE_URL_ERROR,
  storeLink,
  storeUrlError,
} from "./store-link"

const cases: [string, boolean][] = [
  ["", true],
  ["   ", true],
  ["https://www.tokopedia.com/toko/produk", true],
  ["http://vendor.co.id/p?id=1", true],
  ["HTTPS://Shop.Example.com", true],
  ["  https://shop.example.com  ", true],
  ["javascript:alert(1)", false],
  ["data:text/html,hi", false],
  ["ftp://files.example.com", false],
  ["www.tokopedia.com", false],
  ["https://", false],
  ["https://shop example.com", false],
  [`https://e.com/${"a".repeat(2048)}`, false],
]

describe.each([
  ["productUrlError", productUrlError, PRODUCT_URL_ERROR],
  ["storeUrlError", storeUrlError, STORE_URL_ERROR],
])("%s", (_name, check, message) => {
  it.each(cases)("%j", (input, ok) => {
    expect(check(input)).toBe(ok ? null : message)
  })
})

describe("messages", () => {
  it("name the link they sit on", () => {
    expect(PRODUCT_URL_ERROR).toBe("Link produk harus diawali http:// atau https://.")
    expect(STORE_URL_ERROR).toBe("Link toko harus diawali http:// atau https://.")
  })
})

describe("storeLink", () => {
  it("names the host without www", () => {
    expect(storeLink("https://www.tokopedia.com/toko/produk")).toEqual({
      href: "https://www.tokopedia.com/toko/produk",
      host: "tokopedia.com",
    })
  })

  it("keeps any other host", () => {
    expect(storeLink("http://shop.vendor.co.id")?.host).toBe("shop.vendor.co.id")
  })

  it.each([undefined, null, "", "javascript:alert(1)", "www.vendor.com"])("refuses %j", (input) => {
    expect(storeLink(input)).toBeNull()
  })
})
