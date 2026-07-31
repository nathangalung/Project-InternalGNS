import { useState } from "react"
import {
  chipStyle,
  STATUS_FILTER_OPTIONS as STATUS_OPTIONS,
  type StatusFilterValue,
} from "@/components/shared/filter-styles"

export type VendorStatusFilter = StatusFilterValue

export interface VendorFilterValues {
  status: VendorStatusFilter
  countryName: string // free-text location substring; "" means all
  minTotal: string // digits-only string; "" or "0" means no min
}

interface VendorFilterProps {
  onClose: () => void
  onApply: (filters: VendorFilterValues) => void
  initialValues?: VendorFilterValues
}

const DEFAULTS: VendorFilterValues = { status: "all", countryName: "", minTotal: "" }

export default function VendorFilter({ onClose, onApply, initialValues }: VendorFilterProps) {
  const [status, setStatus] = useState<VendorStatusFilter>(initialValues?.status ?? "all")
  const [location, setLocation] = useState<string>(initialValues?.countryName ?? "")
  const [minTotal, setMinTotal] = useState<string>(initialValues?.minTotal ?? "")

  const dirty =
    status !== DEFAULTS.status ||
    location !== DEFAULTS.countryName ||
    (minTotal !== "" && minTotal !== "0")

  const handleReset = () => {
    setStatus("all")
    setLocation("")
    setMinTotal("")
  }

  const handleApply = () => {
    onApply({ status, countryName: location.trim(), minTotal })
    onClose()
  }

  const formatRupiah = (digits: string) => {
    if (!digits) return ""
    const n = Number(digits)
    if (!Number.isFinite(n)) return ""
    return n.toLocaleString("id-ID")
  }

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ca-header">
          <h2 className="ca-title">Filter Vendor</h2>
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
            <div className="ca-section-heading">Status Vendor</div>
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
            <div className="ca-section-heading">Lokasi</div>
            <div className="ca-field">
              <input
                type="text"
                placeholder="Ketik lokasi vendor..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="h-11 w-full rounded-md border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-3.5 py-2.5 text-sm text-[#191C1E] outline-none"
              />
            </div>
          </div>

          <div className="ca-section">
            <div className="ca-section-heading">Min Total Pembelian</div>
            <div className="ca-field">
              <div className="ca-phone-wrapper">
                <span className="ca-phone-prefix">IDR</span>
                <input
                  className="ca-phone-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={formatRupiah(minTotal)}
                  onChange={(e) => setMinTotal(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="ca-footer justify-between px-6 py-4">
          <button
            type="button"
            onClick={handleReset}
            disabled={!dirty}
            className={`border-0 bg-transparent p-0 text-[13px] font-medium underline-offset-[3px] ${
              dirty
                ? "cursor-pointer text-[#630ED4] underline"
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
