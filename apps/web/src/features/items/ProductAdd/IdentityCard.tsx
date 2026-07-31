import { ui } from "@/lib/ui"
import {
  AddNewButton,
  type CatalogItem,
  CheckmarkIcon,
  type DropdownKey,
  disabledStyle,
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
  formatKodeNama,
  type ProductAddFormData,
} from "./helpers"

interface IdentityCardProps {
  form: ProductAddFormData
  onChange: (field: keyof ProductAddFormData, value: string) => void
  productCatalog: CatalogItem[]
  productMatches: CatalogItem[]
  requestMatches: CatalogItem[]
  activeProductLabel?: string
  productOpen: boolean
  productRequestOpen: boolean
  satuanOpen: boolean
  satuanOptions: string[]
  setOpenDropdown: (key: DropdownKey | null) => void
  closeIfMatch: (key: DropdownKey) => void
  toggleDropdown: (key: DropdownKey) => void
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
  satuanOpen,
  satuanOptions,
  setOpenDropdown,
  closeIfMatch,
  toggleDropdown,
  isProductFilled,
  isSatuanFilled,
  onAddProductNew,
  onPickProduct,
  onPickRequestSuggestion,
  onCopyRequestToOffer,
}: IdentityCardProps) {
  const canCopy = form.requestedKodeImpaNama.trim().length > 0
  const activeRequestLabel = form.requestedKodeImpaNama.trim()
  return (
    <>
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Permintaan Klien (Request)</div>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>
            Kode IMPA/Nama Produk Request <span className="text-primary-700">*</span>
          </label>
          <div className="relative">
            <input
              className={`${ui.fieldInput} font-sans`}
              type="text"
              placeholder="Cari produk atau ketik permintaan klien"
              value={form.requestedKodeImpaNama}
              onChange={(e) => {
                onChange("requestedKodeImpaNama", e.target.value)
                setOpenDropdown("productRequest")
              }}
              onFocus={() => setOpenDropdown("productRequest")}
              onBlur={() => setTimeout(() => closeIfMatch("productRequest"), 150)}
            />
            {productRequestOpen && (
              <div style={dropdownPanelStyle}>
                {requestMatches.length === 0 ? (
                  <div className="px-5 py-2.5" style={dropdownLabelStyle(false)}>
                    Tidak ada rekomendasi — input akan disimpan apa adanya.
                  </div>
                ) : (
                  <>
                    <div className="px-5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.6px] text-[#9CA3AF]">
                      Rekomendasi dari katalog
                    </div>
                    {requestMatches.map((p) => {
                      const label = formatKodeNama(p.kode, p.nama)
                      const isActive = label === activeRequestLabel
                      return (
                        <button
                          key={p.id ?? label}
                          type="button"
                          style={dropdownItemStyle}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            onChange("requestedKodeImpaNama", label)
                            onPickRequestSuggestion?.(p)
                            setOpenDropdown(null)
                          }}
                        >
                          <span style={dropdownLabelStyle(isActive)}>{label}</span>
                          {isActive && <CheckmarkIcon />}
                        </button>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {onCopyRequestToOffer && (
        <div className="-mt-2 mb-2 flex items-center gap-3 rounded-md border border-dashed border-[rgba(99,14,212,0.25)] bg-[rgba(99,14,212,0.04)] px-3.5 py-2.5">
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[rgba(99,14,212,0.12)] text-primary-700"
            aria-hidden
          >
            <svg
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
            className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-sm px-3.5 py-2 text-[12px] font-semibold transition-colors duration-150 ${
              canCopy
                ? "cursor-pointer bg-primary-700 text-white"
                : "cursor-not-allowed bg-[rgba(99,14,212,0.18)] text-[rgba(99,14,212,0.55)]"
            }`}
          >
            <svg
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
          <label className={ui.fieldLabel}>
            Kode IMPA/Nama Produk <span className="text-primary-700">*</span>
          </label>
          <div className="relative">
            <input
              className={`${ui.fieldInput} font-sans`}
              type="text"
              placeholder="Masukkan nama atau kode IMPA"
              value={form.kodeImpaNama}
              onChange={(e) => {
                onChange("kodeImpaNama", e.target.value)
                setOpenDropdown("product")
              }}
              onFocus={() => setOpenDropdown("product")}
              onBlur={() => setTimeout(() => closeIfMatch("product"), 150)}
            />
            {productOpen && (
              <div style={dropdownPanelStyle}>
                {productMatches.length === 0 ? (
                  <div className="px-5 py-2.5" style={dropdownLabelStyle(false)}>
                    Tidak ada hasil
                  </div>
                ) : (
                  productMatches.map((p) => {
                    const label = formatKodeNama(p.kode, p.nama)
                    const isActive = label === activeProductLabel
                    return (
                      <button
                        key={p.id ?? label}
                        type="button"
                        style={dropdownItemStyle}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          onChange("kodeImpaNama", label)
                          onPickProduct?.(p)
                          setOpenDropdown(null)
                        }}
                      >
                        <span style={dropdownLabelStyle(isActive)}>{label}</span>
                        {isActive && <CheckmarkIcon />}
                      </button>
                    )
                  })
                )}
                <AddNewButton label="Tambah Produk Baru" onClick={onAddProductNew} />
              </div>
            )}
          </div>
        </div>

        <div className={ui.row2}>
          <div className={ui.field}>
            <label className={ui.fieldLabel}>
              Satuan <span className="text-primary-700">*</span>
            </label>
            <div className="relative">
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border-[1.5px] border-transparent bg-dark-200 px-4 py-3 text-sm font-normal text-dark-900 outline-none transition focus:border-primary-600 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"
                onClick={() => {
                  if (isProductFilled) toggleDropdown("satuan")
                }}
                onBlur={() => setTimeout(() => closeIfMatch("satuan"), 150)}
                disabled={!isProductFilled}
                style={{
                  ...(!isProductFilled ? disabledStyle : {}),
                  color: !form.satuan && isProductFilled ? "var(--color-text-muted)" : undefined,
                }}
              >
                <span>{form.satuan || "Pilih satuan"}</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {satuanOpen && isProductFilled && (
                <div style={dropdownPanelStyle}>
                  {satuanOptions.map((opt) => {
                    const isActive = form.satuan === opt
                    return (
                      <button
                        key={opt}
                        type="button"
                        style={dropdownItemStyle}
                        onClick={() => {
                          onChange("satuan", opt)
                          setOpenDropdown(null)
                        }}
                      >
                        <span style={dropdownLabelStyle(isActive)}>{opt}</span>
                        {isActive && <CheckmarkIcon />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel}>
              Jumlah Produk <span className="text-primary-700">*</span>
            </label>
            <input
              className={`${ui.fieldInput} font-sans`}
              type="number"
              min={1}
              placeholder="Masukkan jumlah produk"
              value={form.jumlahProduk}
              onChange={(e) => onChange("jumlahProduk", e.target.value)}
              disabled={!isSatuanFilled}
              style={!isSatuanFilled ? disabledStyle : undefined}
            />
          </div>
        </div>
      </div>
    </>
  )
}
