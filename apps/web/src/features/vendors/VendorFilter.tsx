import { useState } from "react"
import {
  chipStyle,
  STATUS_FILTER_OPTIONS as STATUS_OPTIONS,
  type StatusFilterValue,
} from "@/components/shared/filter-styles"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"

// Faithful port of the legacy amount-input group.
const amountWrapCls =
  "flex h-11 overflow-hidden rounded-md border-[1.5px] border-transparent bg-dark-200 transition focus-within:border-primary-600 focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]"
const amountPrefixCls =
  "flex items-center whitespace-nowrap border-r border-dark-300 px-3 text-sm font-medium text-dark-600"
const amountInputCls =
  "min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-dark-900 outline-none placeholder:text-dark-500"

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
    <Modal
      title="Filter Vendor"
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
        <div className={ui.modalSectionHeading}>Status Vendor</div>
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
        <div className={ui.modalSectionHeading}>Lokasi</div>
        <div className={ui.field}>
          <input
            type="text"
            placeholder="Ketik lokasi vendor..."
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="h-11 w-full rounded-md border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-3.5 py-2.5 text-sm text-[#191C1E] outline-none"
          />
        </div>
      </div>

      <div className={ui.modalSection}>
        <div className={ui.modalSectionHeading}>Min Total Pembelian</div>
        <div className={ui.field}>
          <div className={amountWrapCls}>
            <span className={amountPrefixCls}>IDR</span>
            <input
              className={amountInputCls}
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
