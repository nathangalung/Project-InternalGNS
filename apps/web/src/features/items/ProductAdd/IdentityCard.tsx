import { useId } from "react"
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@/components/ui/autocomplete"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { dropdownLabel, ui } from "@/lib/ui"
import {
  AddNewButton,
  type CatalogItem,
  CheckmarkIcon,
  type DropdownKey,
  formatKodeNama,
  type ProductAddFormData,
} from "./helpers"

type IdentityCardProps = {
  form: ProductAddFormData
  onChange: (field: keyof ProductAddFormData, value: string) => void
  productCatalog: CatalogItem[]
  productMatches: CatalogItem[]
  requestMatches: CatalogItem[]
  activeProductLabel?: string
  productOpen: boolean
  productRequestOpen: boolean
  satuanOptions: string[]
  setOpenDropdown: (key: DropdownKey | null) => void
  closeIfMatch: (key: DropdownKey) => void
  isProductFilled: boolean
  isSatuanFilled: boolean
  onAddProductNew: () => void
  onPickProduct?: (item: CatalogItem) => void
  onPickRequestSuggestion?: (item: CatalogItem) => void
  onCopyRequestToOffer?: () => void
}

// Product identity card.
export default function IdentityCard({
  form,
  onChange,
  productMatches,
  requestMatches,
  activeProductLabel,
  productOpen,
  productRequestOpen,
  satuanOptions,
  setOpenDropdown,
  closeIfMatch,
  isProductFilled,
  isSatuanFilled,
  onAddProductNew,
  onPickProduct,
  onPickRequestSuggestion,
  onCopyRequestToOffer,
}: IdentityCardProps) {
  const requestId = useId()
  const offerId = useId()
  const unitId = useId()
  const qtyId = useId()
  const canCopy = form.requestedKodeImpaNama.trim().length > 0
  const activeRequestLabel = form.requestedKodeImpaNama.trim()
  // Per-field open and close.
  const openProps = (key: DropdownKey) => ({
    onOpenChange: (open: boolean) => (open ? setOpenDropdown(key) : closeIfMatch(key)),
  })
  return (
    <>
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Permintaan Klien (Request)</div>
        <div className={ui.field}>
          <label htmlFor={requestId} className={ui.fieldLabel}>
            Kode IMPA/Nama Produk Request <span className="text-primary-700">*</span>
          </label>
          <Autocomplete
            value={form.requestedKodeImpaNama}
            onValueChange={(v, d) => {
              if (d.reason === "input-change") onChange("requestedKodeImpaNama", v)
            }}
            open={productRequestOpen}
            {...openProps("productRequest")}
          >
            <AutocompleteInput
              id={requestId}
              className="font-sans"
              placeholder="Cari produk atau ketik permintaan klien"
              onFocus={() => setOpenDropdown("productRequest")}
            />
            <AutocompleteContent>
              {requestMatches.length === 0 ? (
                <div className={`px-5 py-2.5 ${dropdownLabel(false)}`}>
                  Tidak ada rekomendasi — input akan disimpan apa adanya.
                </div>
              ) : (
                <AutocompleteList>
                  <AutocompleteGroup>
                    <AutocompleteGroupLabel>Rekomendasi dari katalog</AutocompleteGroupLabel>
                    {requestMatches.map((p) => {
                      const label = formatKodeNama(p.kode, p.nama)
                      const isActive = label === activeRequestLabel
                      return (
                        <AutocompleteItem
                          key={p.id ?? label}
                          value={label}
                          onClick={() => {
                            onChange("requestedKodeImpaNama", label)
                            onPickRequestSuggestion?.(p)
                            setOpenDropdown(null)
                          }}
                        >
                          <span className={dropdownLabel(isActive)}>{label}</span>
                          {isActive && <CheckmarkIcon />}
                        </AutocompleteItem>
                      )
                    })}
                  </AutocompleteGroup>
                </AutocompleteList>
              )}
            </AutocompleteContent>
          </Autocomplete>
        </div>
      </div>

      {onCopyRequestToOffer && (
        <div className="-mt-2 mb-2 flex items-center gap-3 rounded-md border border-dashed border-[rgba(99,14,212,0.25)] bg-[rgba(99,14,212,0.04)] px-3.5 py-2.5">
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[rgba(99,14,212,0.12)] text-primary-700"
            aria-hidden
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M19 12l-7 7-7-7" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-caption font-semibold leading-[1.4] text-[#4A4455]">
              Salin produk request langsung sebagai offer.
            </div>
          </div>
          <button
            type="button"
            onClick={onCopyRequestToOffer}
            disabled={!canCopy}
            title="Pakai nilai request sebagai offer (untuk produk baru di luar katalog)"
            className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-sm px-3.5 py-2 text-[12px] font-semibold transition-colors duration-150 ${ui.focusRing} ${
              canCopy
                ? "cursor-pointer bg-primary-700 text-white"
                : "cursor-not-allowed bg-[rgba(99,14,212,0.18)] text-[rgba(99,14,212,0.55)]"
            }`}
          >
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Salin ke Offer
          </button>
        </div>
      )}

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Produk yang Ditawarkan (Offer)</div>

        <div className={ui.field}>
          <label htmlFor={offerId} className={ui.fieldLabel}>
            Kode IMPA/Nama Produk <span className="text-primary-700">*</span>
          </label>
          <Autocomplete
            value={form.kodeImpaNama}
            onValueChange={(v, d) => {
              if (d.reason === "input-change") onChange("kodeImpaNama", v)
            }}
            open={productOpen}
            {...openProps("product")}
          >
            <AutocompleteInput
              id={offerId}
              className="font-sans"
              placeholder="Masukkan nama atau kode IMPA"
              onFocus={() => setOpenDropdown("product")}
            />
            <AutocompleteContent>
              {productMatches.length === 0 ? (
                <div className={`px-5 py-2.5 ${dropdownLabel(false)}`}>Tidak ada hasil</div>
              ) : (
                <AutocompleteList>
                  {productMatches.map((p) => {
                    const label = formatKodeNama(p.kode, p.nama)
                    const isActive = label === activeProductLabel
                    return (
                      <AutocompleteItem
                        key={p.id ?? label}
                        value={label}
                        onClick={() => {
                          onChange("kodeImpaNama", label)
                          onPickProduct?.(p)
                          setOpenDropdown(null)
                        }}
                      >
                        <span className={dropdownLabel(isActive)}>{label}</span>
                        {isActive && <CheckmarkIcon />}
                      </AutocompleteItem>
                    )
                  })}
                </AutocompleteList>
              )}
              <AddNewButton label="Tambah Produk Baru" onClick={onAddProductNew} />
            </AutocompleteContent>
          </Autocomplete>
        </div>

        <div className={ui.row2}>
          <div className={ui.field}>
            <label htmlFor={unitId} className={ui.fieldLabel}>
              Satuan <span className="text-primary-700">*</span>
            </label>
            <Select
              modal={false}
              value={form.satuan || null}
              onValueChange={(v) => {
                if (v !== null) onChange("satuan", v)
              }}
              disabled={!isProductFilled}
            >
              <SelectTrigger
                id={unitId}
                // Disabled and empty keeps the dark placeholder.
                className={isProductFilled ? undefined : "data-placeholder:text-dark-900"}
              >
                <SelectValue placeholder="Pilih satuan" />
              </SelectTrigger>
              <SelectContent>
                {satuanOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={ui.field}>
            <label htmlFor={qtyId} className={ui.fieldLabel}>
              Jumlah Produk <span className="text-primary-700">*</span>
            </label>
            <input
              id={qtyId}
              className={`${ui.fieldInput} font-sans ${ui.disabledField}`}
              type="number"
              min={1}
              placeholder="Masukkan jumlah produk"
              value={form.jumlahProduk}
              onChange={(e) => onChange("jumlahProduk", e.target.value)}
              disabled={!isSatuanFilled}
            />
          </div>
        </div>
      </div>
    </>
  )
}
