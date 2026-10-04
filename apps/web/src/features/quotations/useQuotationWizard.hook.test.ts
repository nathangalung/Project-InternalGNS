import { act } from "react"
import { describe, expect, it } from "vitest"
import type { ProductAddFormData } from "@/features/items/ProductAdd/helpers"
import { ApiError } from "@/lib/api-client"
import { problem } from "@/test/problem"
import { renderHook } from "@/test/renderHook"
import { useQuotationWizard } from "./useQuotationWizard"

const UNITS = [{ id: 1, code: "PCS" }]

const FORM: ProductAddFormData = {
  requestedKodeImpaNama: "",
  kodeImpaNama: "LAMP LED",
  jumlahProduk: "2",
  satuan: "PCS",
  namaVendor: "CV Laut",
  hargaBeli: "60",
  hargaJual: "100",
}

function wizard() {
  return renderHook(
    (units: typeof UNITS | undefined) => useQuotationWizard(units),
    UNITS as typeof UNITS | undefined,
  )
}

describe("useQuotationWizard", () => {
  it("starts empty on step 1 with Lanjut held", () => {
    const { result } = wizard()
    expect(result.current.step).toBe(1)
    expect(result.current.isNextDisabled).toBe(true)
    expect(result.current.products).toEqual([])
    expect(result.current.gates.hasContent).toBe(false)
    expect(result.current.summary.grandTotal).toBe(0)
  })

  it("releases Lanjut once a client is picked, and only on step 1", () => {
    const { result } = wizard()
    act(() => result.current.setSelectedClient("7"))
    expect(result.current.isNextDisabled).toBe(false)
    act(() => {
      result.current.setSelectedClient("")
      result.current.setStep(2)
    })
    expect(result.current.isNextDisabled).toBe(false)
  })

  it("adds, edits and deletes product lines", () => {
    const { result } = wizard()
    act(() => result.current.saveProduct(FORM))
    expect(result.current.products).toHaveLength(1)
    expect(result.current.summary.totalHargaJual).toBe(200)
    expect(result.current.unitsOk).toBe(true)
    expect(result.current.unknownUnits).toBe(0)

    act(() => result.current.setEditingProduct(result.current.products[0]))
    act(() => result.current.saveProduct({ ...FORM, jumlahProduk: "5" }))
    expect(result.current.products).toHaveLength(1)
    expect(result.current.products[0].jumlah).toBe(5)
    expect(result.current.editingProduct).toBeNull()

    act(() => result.current.deleteProduct(result.current.products[0].id))
    expect(result.current.products).toEqual([])
  })

  it("closing the product form drops the edited line", () => {
    const { result } = wizard()
    act(() => result.current.saveProduct(FORM))
    act(() => {
      result.current.setEditingProduct(result.current.products[0])
      result.current.setProductAddOpen(true)
    })
    expect(result.current.showProductAdd).toBe(true)
    act(() => result.current.setProductAddOpen(false))
    expect(result.current.showProductAdd).toBe(false)
    expect(result.current.editingProduct).toBeNull()
  })

  it("keeps the edited line while the form stays open", () => {
    const { result } = wizard()
    act(() => result.current.saveProduct(FORM))
    act(() => result.current.setEditingProduct(result.current.products[0]))
    act(() => result.current.setProductAddOpen(true))
    expect(result.current.editingProduct).not.toBeNull()
  })

  it("flags a unit the catalog does not know", () => {
    const { result, rerender } = wizard()
    act(() => result.current.saveProduct({ ...FORM, satuan: "BOX" }))
    expect(result.current.unitsOk).toBe(false)
    expect(result.current.unknownUnits).toBe(1)
    rerender(undefined)
    expect(result.current.unitIdByCode.size).toBe(0)
  })

  it("clears the cost when the days are cleared, not when the address changes", () => {
    const { result } = wizard()
    act(() => {
      result.current.setShippingTime("3")
      result.current.setShippingCost("75000")
    })
    act(() => result.current.setShippingAddress("Jl. A"))
    expect(result.current.shippingCost).toBe("75000")
    act(() => result.current.setShippingTime(""))
    expect(result.current.shippingCost).toBe("")
  })

  it("pins a 422 qty error to the lines it was raised for", () => {
    const { result } = wizard()
    act(() => result.current.saveProduct(FORM))
    const err = new ApiError(
      422,
      problem(422, { fields: { "items[0].qty": "Jumlah harus lebih besar dari 0." } }),
      "x",
    )
    act(() => result.current.recordQtyFailure(err))
    const id = result.current.products[0].id
    expect(result.current.qtyErrors).toEqual({ [id]: "Jumlah harus lebih besar dari 0." })
    act(() => result.current.saveProduct(FORM))
    expect(result.current.qtyErrors).toEqual({})
  })

  it("tracks the paging, discount and modal state it owns", () => {
    const { result } = wizard()
    act(() => {
      result.current.setProdPage(2)
      result.current.setProdPageSize(10)
      result.current.setIsRowDropdownOpen(true)
      result.current.setDiscountPct(15)
      result.current.setShowDiscountModal(true)
      result.current.setSelectedContactId(4)
      result.current.setJatuhTempo("30")
      result.current.setBerlakuSampai("14")
      result.current.setProducts([])
    })
    expect(result.current).toMatchObject({
      prodPage: 2,
      prodPageSize: 10,
      isRowDropdownOpen: true,
      discountPct: 15,
      showDiscountModal: true,
      selectedContactId: 4,
    })
    expect(result.current.gates.isTenggatWaktuFilled).toBe(true)
  })
})

describe("useQuotationWizard seed", () => {
  it("loads every step and returns to the first product page", () => {
    const { result } = wizard()
    act(() => result.current.setProdPage(3))
    act(() =>
      result.current.seed({
        selectedClient: "3",
        selectedContactId: 8,
        discountPct: 5,
        products: [],
        shippingAddress: "Jl. Pelabuhan No. 1, Jakarta Utara",
        shippingTime: "4",
        shippingCost: "75000",
        berlakuSampai: "14",
        jatuhTempo: "30",
        clientRefNo: "RFQ-7",
      }),
    )
    expect(result.current).toMatchObject({
      selectedClient: "3",
      selectedContactId: 8,
      discountPct: 5,
      prodPage: 1,
      shippingTime: "4",
      shippingCost: "75000",
      berlakuSampai: "14",
      jatuhTempo: "30",
      clientRefNo: "RFQ-7",
    })
    expect(result.current.gates.isWaktuFilled).toBe(true)
  })

  it("follows the server without moving the page or the user's header", () => {
    const { result } = wizard()
    const stored = {
      selectedClient: "3",
      selectedContactId: 8,
      discountPct: 5,
      products: [],
      shippingAddress: "Jl. Pelabuhan No. 1, Jakarta Utara",
      shippingTime: "4",
      shippingCost: "75000",
      berlakuSampai: "14",
      jatuhTempo: "30",
      clientRefNo: "RFQ-7",
    }
    act(() => result.current.saveProduct(FORM))
    act(() => result.current.setProdPage(2))
    act(() => result.current.setShippingTime("9"))
    act(() => result.current.setClientRefNo("RFQ-8"))

    // Editing the header: only the lines follow.
    act(() => result.current.syncFromServer(stored, false))
    expect(result.current).toMatchObject({
      products: [],
      prodPage: 2,
      shippingTime: "9",
      clientRefNo: "RFQ-8",
      selectedClient: "",
    })

    act(() => result.current.syncFromServer(stored, true))
    expect(result.current).toMatchObject({
      prodPage: 2,
      selectedClient: "",
      discountPct: 5,
      shippingAddress: "Jl. Pelabuhan No. 1, Jakarta Utara",
      shippingTime: "4",
      shippingCost: "75000",
      berlakuSampai: "14",
      jatuhTempo: "30",
      clientRefNo: "RFQ-7",
    })
  })
})

describe("live contact", () => {
  const stored = (selectedContactId: number) => ({
    selectedClient: "3",
    selectedContactId,
    discountPct: 0,
    products: [],
    shippingAddress: "",
    shippingTime: "",
    shippingCost: "",
    berlakuSampai: "",
    jatuhTempo: "",
    clientRefNo: "",
  })

  it("follows another editor's contact", () => {
    const { result } = wizard()
    act(() => result.current.seed(stored(8)))
    act(() => result.current.syncFromServer(stored(9), true))
    expect(result.current.selectedContactId).toBe(9)
  })

  it("keeps a pick while the stored contact stays", () => {
    const { result } = wizard()
    act(() => result.current.seed(stored(8)))
    act(() => result.current.setSelectedContactId(4))
    act(() => result.current.syncFromServer(stored(8), false))
    expect(result.current.selectedContactId).toBe(4)
  })

  it("drops a pick the stored contact changed under", () => {
    const { result } = wizard()
    act(() => result.current.seed(stored(8)))
    act(() => result.current.setSelectedContactId(4))
    act(() => result.current.syncFromServer(stored(10), true))
    expect(result.current.selectedContactId).toBe(10)
  })
})

describe("no-offer lines", () => {
  it("toggles a line out of the offer and back, keeping its prices", () => {
    const { result } = wizard()
    act(() => result.current.saveProduct(FORM))
    const id = result.current.products[0].id
    expect(result.current.incompleteLines).toBe(1)

    act(() => result.current.toggleNoOffer(id))
    expect(result.current.products[0].noOffer).toBe(true)
    expect(result.current.summary.totalHargaJual).toBe(0)
    expect(result.current.incompleteLines).toBe(0)

    act(() => result.current.toggleNoOffer(id))
    expect(result.current.products[0].noOffer).toBe(false)
    expect(result.current.summary.totalHargaJual).toBe(200)
  })
})
