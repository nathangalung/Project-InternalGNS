import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ProductAddFormData } from "@/features/items/ProductAdd/helpers"
import { countInvalidQty, isLineComplete, qtyErrorIndexes, qtyErrorsById } from "./lines"
import {
  countUnknownUnits,
  type ProductItem,
  unitIdIndex,
  upsertProduct,
  type WizardSeed,
  wizardGates,
  wizardSummary,
} from "./wizard"

// Shared quotation wizard state.
//
// QuotationAdd and QuotationEdit run the same four steps over the same
// fields; each keeps only its own client picking, loading and save call.
export function useQuotationWizard(units: { id: number; code: string }[] | undefined) {
  const [step, setStep] = useState(1)

  const [selectedClient, setSelectedClient] = useState("")
  const [selectedContactId, setSelectedContactId] = useState<number | undefined>(undefined)

  const [showProductAdd, setShowProductAdd] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null)
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [discountPct, setDiscountPct] = useState<number>(0)

  const [products, setProducts] = useState<ProductItem[]>([])
  const [prodPageSize, setProdPageSize] = useState(5)
  const [prodPage, setProdPage] = useState(1)
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false)

  const [shippingAddress, setShippingAddress] = useState("")
  const [shippingTime, setShippingTime] = useState("")
  const [shippingCost, setShippingCost] = useState("")

  const [jatuhTempo, setJatuhTempo] = useState("")
  const [berlakuSampai, setBerlakuSampai] = useState("")

  const [qtyFail, setQtyFail] = useState<{
    lines: ProductItem[]
    byId: Record<number, string>
  } | null>(null)

  // Cost follows the days only; typing an address must not wipe them.
  const hasShippingTime = shippingTime.trim().length > 0
  useEffect(() => {
    if (!hasShippingTime) setShippingCost("")
  }, [hasShippingTime])

  const gates = wizardGates({
    shippingAddress,
    shippingTime,
    jatuhTempo,
    berlakuSampai,
    productCount: products.length,
  })
  const summary = wizardSummary(products, discountPct, shippingCost)
  const unitIdByCode = useMemo(() => unitIdIndex(units), [units])

  function deleteProduct(id: number) {
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  // Mark or unmark Tidak Ditawarkan.
  // Prices stay on the line, so marking it back restores them.
  function toggleNoOffer(id: number) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, noOffer: !p.noOffer } : p)))
  }

  function saveProduct(data: ProductAddFormData) {
    setProducts((prev) => upsertProduct(prev, editingProduct, data))
    setEditingProduct(null)
  }

  // Closing drops the edited line.
  function setProductAddOpen(open: boolean) {
    setShowProductAdd(open)
    if (!open) setEditingProduct(null)
  }

  // Last stored contact.
  const storedContact = useRef<number | undefined>(undefined)

  // Load every step at once.
  // Each field is set outright, so a reseed also drops removed lines.
  const seed = useCallback((s: WizardSeed) => {
    storedContact.current = s.selectedContactId
    setSelectedClient(s.selectedClient)
    setSelectedContactId(s.selectedContactId)
    setDiscountPct(s.discountPct)
    setProducts(s.products)
    setProdPage(1)
    setShippingAddress(s.shippingAddress)
    setShippingTime(s.shippingTime)
    setShippingCost(s.shippingCost)
    setBerlakuSampai(s.berlakuSampai)
    setJatuhTempo(s.jatuhTempo)
  }, [])

  // Follow the stored draft live.
  // Lines always follow the server; the header fields only when the caller
  // is not editing them. A pick holds the header, so a stored contact that
  // still changes (a claim that lapsed) replaces the pick instead of being
  // overwritten by it. Page and client stay as the user left them.
  const syncFromServer = useCallback((s: WizardSeed, header: boolean) => {
    if (s.selectedContactId !== storedContact.current) setSelectedContactId(s.selectedContactId)
    storedContact.current = s.selectedContactId
    setProducts(s.products)
    if (!header) return
    setDiscountPct(s.discountPct)
    setShippingAddress(s.shippingAddress)
    setShippingTime(s.shippingTime)
    setShippingCost(s.shippingCost)
    setBerlakuSampai(s.berlakuSampai)
    setJatuhTempo(s.jatuhTempo)
  }, [])

  // Server qty errors, per line.
  function recordQtyFailure(err: unknown) {
    setQtyFail({ lines: products, byId: qtyErrorsById(products, qtyErrorIndexes(err)) })
  }

  const unknownUnits = countUnknownUnits(products, unitIdByCode)

  return {
    step,
    setStep,
    isNextDisabled: step === 1 && selectedClient === "",
    selectedClient,
    setSelectedClient,
    selectedContactId,
    setSelectedContactId,
    showProductAdd,
    setShowProductAdd,
    setProductAddOpen,
    editingProduct,
    setEditingProduct,
    showDiscountModal,
    setShowDiscountModal,
    discountPct,
    setDiscountPct,
    products,
    setProducts,
    deleteProduct,
    toggleNoOffer,
    saveProduct,
    prodPageSize,
    setProdPageSize,
    prodPage,
    setProdPage,
    isRowDropdownOpen,
    setIsRowDropdownOpen,
    shippingAddress,
    setShippingAddress,
    shippingTime,
    setShippingTime,
    shippingCost,
    setShippingCost,
    jatuhTempo,
    setJatuhTempo,
    berlakuSampai,
    setBerlakuSampai,
    gates,
    summary,
    unitIdByCode,
    unknownUnits,
    unitsOk: unknownUnits === 0,
    invalidQty: countInvalidQty(products),
    // Lines not yet ready to be sent
    incompleteLines: products.filter((p) => !isLineComplete(p)).length,
    // Server errors apply to the lines they were raised for.
    qtyErrors: qtyFail?.lines === products ? qtyFail.byId : {},
    recordQtyFailure,
    seed,
    syncFromServer,
  }
}
