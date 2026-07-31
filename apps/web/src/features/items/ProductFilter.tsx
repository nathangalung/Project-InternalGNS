import { useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  chipStyle,
  dropdownItemStyle,
  dropdownLabelStyle,
  STATUS_FILTER_OPTIONS as STATUS_OPTIONS,
  type StatusFilterValue,
} from "@/components/shared/filter-styles"
import { useUnits } from "@/features/units/hooks"

export type ProductStatusFilter = StatusFilterValue

export interface ProductFilterValues {
  status: ProductStatusFilter
  unitCode: string // "" means all
}

interface ProductFilterProps {
  onClose: () => void
  onApply: (filters: ProductFilterValues) => void
  initialValues?: ProductFilterValues
}

const DEFAULTS: ProductFilterValues = { status: "all", unitCode: "" }

export default function ProductFilter({ onClose, onApply, initialValues }: ProductFilterProps) {
  const [status, setStatus] = useState<ProductStatusFilter>(initialValues?.status ?? "all")
  const [unitCode, setUnitCode] = useState<string>(initialValues?.unitCode ?? "")
  const [unitQuery, setUnitQuery] = useState<string>(initialValues?.unitCode ?? "")
  const [showUnitSuggestions, setShowUnitSuggestions] = useState(false)

  const { data: units } = useUnits()

  const filteredUnits = (units ?? [])
    .filter((u) => {
      if (!unitQuery) return true
      const q = unitQuery.toLowerCase()
      return u.code.toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q)
    })
    .slice(0, 5)

  const dirty = status !== DEFAULTS.status || unitCode !== DEFAULTS.unitCode

  const handleReset = () => {
    setStatus("all")
    setUnitCode("")
    setUnitQuery("")
    setShowUnitSuggestions(false)
  }

  const handleApply = () => {
    onApply({ status, unitCode })
    onClose()
  }

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Filter Produk</h2>
          <button className="ca-close-btn" onClick={onClose} title="Tutup">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        <div className="ca-body">
          <div className="ca-section">
            <div className="ca-section-heading">Status Produk</div>
            <div className="ca-field">
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setStatus(o.value)}
                    style={chipStyle(status === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Satuan</div>
            <div className="ca-field">
              <div className="relative">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94A3B8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Ketik nama satuan..."
                  value={unitQuery}
                  onChange={(e) => {
                    setUnitQuery(e.target.value)
                    setShowUnitSuggestions(true)
                    if (unitCode) setUnitCode("")
                  }}
                  onFocus={() => {
                    if (unitQuery.length > 0 && !unitCode) setShowUnitSuggestions(true)
                  }}
                  className="h-11 w-full rounded-md border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-9 py-2.5 font-sans text-sm text-[#191C1E] outline-none"
                />
                {unitQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setUnitQuery("")
                      setUnitCode("")
                      setShowUnitSuggestions(false)
                    }}
                    title="Bersihkan"
                    className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center p-1 text-[#94A3B8]"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <line x1="1" y1="1" x2="13" y2="13" />
                      <line x1="13" y1="1" x2="1" y2="13" />
                    </svg>
                  </button>
                )}
                {showUnitSuggestions && unitQuery.length > 0 && (
                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-60 overflow-y-auto rounded-md border border-[rgba(204,195,216,0.4)] bg-white py-1 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                    {filteredUnits.length === 0 ? (
                      <div className="px-5 py-3 text-center text-[13px] text-[#94A3B8]">
                        Tidak ada hasil
                      </div>
                    ) : (
                      filteredUnits.map((u) => {
                        const active = unitCode === u.code
                        const label = u.name ? `${u.code} — ${u.name}` : u.code
                        return (
                          <button
                            key={u.id}
                            type="button"
                            style={dropdownItemStyle}
                            onClick={() => {
                              setUnitCode(u.code)
                              setUnitQuery(u.code)
                              setShowUnitSuggestions(false)
                            }}
                          >
                            <span style={dropdownLabelStyle(active)}>{label}</span>
                            {active && <CheckIcon />}
                          </button>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="ca-footer justify-between px-6 py-4">
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            className={`p-0 text-[13px] font-medium ${
              dirty
                ? "cursor-pointer text-[#630ED4] underline underline-offset-[3px]"
                : "cursor-default text-[#CBD5E1] no-underline"
            }`}
          >
            Hapus Filter
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="ca-btn-cancel px-[18px] py-2 text-[13px]"
              onClick={onClose}
            >
              Batal
            </button>
            <button
              type="button"
              className="ca-btn-submit px-[22px] py-2 text-[13px]"
              onClick={handleApply}
            >
              Terapkan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
