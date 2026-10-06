import { describe, expect, it } from "vitest"
import { STORE_URL_ERROR, storeLink, storeUrlError } from "./store-link"

describe("storeUrlError", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["https://www.tokopedia.com/toko/produk", null],
    ["http://vendor.co.id/p?id=1", null],
    ["HTTPS://Shop.Example.com", null],
    ["  https://shop.example.com  ", null],
    ["javascript:alert(1)", STORE_URL_ERROR],
    ["data:text/html,hi", STORE_URL_ERROR],
    ["ftp://files.example.com", STORE_URL_ERROR],
    ["www.tokopedia.com", STORE_URL_ERROR],
    ["https://", STORE_URL_ERROR],
    ["https://shop example.com", STORE_URL_ERROR],
    [`https://e.com/${"a".repeat(2048)}`, STORE_URL_ERROR],
  ])("%j", (input, want) => {
    expect(storeUrlError(input)).toBe(want)
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
