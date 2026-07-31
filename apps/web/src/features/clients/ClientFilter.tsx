import { useState } from "react"
import { CheckIcon } from "@/components/document/icons"
import {
  chipStyle,
  dropdownItemStyle,
  dropdownLabelStyle,
  STATUS_FILTER_OPTIONS as STATUS_OPTIONS,
  type StatusFilterValue,
} from "@/components/shared/filter-styles"
import Modal from "@/components/shared/Modal"
import { useCountries } from "@/features/countries/hooks"
import { ui } from "@/lib/ui"

export type ClientStatusFilter = StatusFilterValue

export interface ClientFilterValues {
  status: ClientStatusFilter
  countryCode: string // "" means all
  minTotal: string // digits-only string; "" or "0" means no min
}

interface ClientFilterProps {
  onClose: () => void
  onApply: (filters: ClientFilterValues) => void
  initialValues?: ClientFilterValues
}

const DEFAULTS: ClientFilterValues = { status: "all", countryCode: "", minTotal: "" }

export default function ClientFilter({ onClose, onApply, initialValues }: ClientFilterProps) {
  const [status, setStatus] = useState<ClientStatusFilter>(initialValues?.status ?? "all")
  const [countryCode, setCountryCode] = useState<string>(initialValues?.countryCode ?? "")
  const [minTotal, setMinTotal] = useState<string>(initialValues?.minTotal ?? "")
  const [countryQuery, setCountryQuery] = useState("")
  const [showCountrySuggestions, setShowCountrySuggestions] = useState(false)

  const { data: countries } = useCountries()

  const filteredCountries = (countries ?? []).filter((c) => {
    if (!countryQuery) return true
    const q = countryQuery.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
  })

  const dirty =
    status !== DEFAULTS.status ||
    countryCode !== DEFAULTS.countryCode ||
    (minTotal !== "" && minTotal !== "0")

  const handleReset = () => {
    setStatus("all")
    setCountryCode("")
    setMinTotal("")
    setCountryQuery("")
    setShowCountrySuggestions(false)
  }

  const handleApply = () => {
    onApply({ status, countryCode, minTotal })
    onClose()
  }

  const formatRupiah = (digits: string) => {
    if (!digits) return ""
    const n = Number(digits)
    if (!Number.isFinite(n)) return ""
    return n.toLocaleString("id-ID")
  }

  return (
    <Modal
      title="Filter Klien"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            className={`mr-auto border-0 bg-transparent p-0 text-[13px] font-medium underline-offset-[3px] ${
              dirty
                ? "cursor-pointer text-primary-700 underline"
                : "cursor-default text-[#CBD5E1] no-underline"
            }`}
          >
            Hapus Filter
          </button>
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button type="button" className={ui.modalSubmit} onClick={handleApply}>
            Terapkan
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Status Klien</div>
        <div className={ui.field}>
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

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Negara Asal</div>
        <div className={ui.field}>
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#94A3B8"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Ketik nama negara..."
              value={countryQuery}
              onChange={(e) => {
                setCountryQuery(e.target.value)
                setShowCountrySuggestions(true)
                if (countryCode) setCountryCode("")
              }}
              onFocus={() => {
                if (countryQuery.length > 0 && !countryCode) setShowCountrySuggestions(true)
              }}
              className="h-11 w-full rounded-md border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-9 py-2.5 text-sm text-[#191C1E] outline-none"
            />
            {countryQuery && (
              <button
                type="button"
                onClick={() => {
                  setCountryQuery("")
                  setCountryCode("")
                  setShowCountrySuggestions(false)
                }}
                title="Bersihkan"
                className="absolute right-2.5 top-1/2 flex -translate-y-1/2 cursor-pointer items-center justify-center border-0 bg-transparent p-1 text-[#94A3B8]"
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
            {showCountrySuggestions && countryQuery.length > 0 && (
              <div className="absolute inset-x-0 top-[calc(100%+4px)] z-50 max-h-[200px] overflow-y-auto rounded-md border border-[rgba(204,195,216,0.4)] bg-white py-1 shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                {filteredCountries.length === 0 ? (
                  <div className="px-5 py-3 text-center text-[13px] text-[#94A3B8]">
                    Tidak ada hasil
                  </div>
                ) : (
                  filteredCountries.slice(0, 5).map((c) => {
                    const active = countryCode === c.code
                    return (
                      <button
                        key={c.code}
                        type="button"
                        style={dropdownItemStyle}
                        onClick={() => {
                          setCountryCode(c.code)
                          setCountryQuery(c.name)
                          setShowCountrySuggestions(false)
                        }}
                      >
                        <span style={dropdownLabelStyle(active)}>{c.name}</span>
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

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Min Total Pembelian</div>
        <div className={ui.field}>
          <div className={ui.prefixWrap}>
            <span className={ui.prefixLabel}>IDR</span>
            <input
              className={ui.prefixInput}
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={formatRupiah(minTotal)}
              onChange={(e) => setMinTotal(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
