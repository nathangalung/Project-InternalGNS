import { useId, useState } from "react"
import FilterFooter from "@/components/shared/FilterFooter"
import Modal from "@/components/shared/Modal"
import {
  STATUS_FILTER_OPTIONS as STATUS_OPTIONS,
  type StatusFilterValue,
} from "@/lib/filter-options"
import { chip, ui } from "@/lib/ui"

// Keeps the UA input font.
const amountInputCls =
  "min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-dark-900 outline-none placeholder:text-dark-500"

export type VendorStatusFilter = StatusFilterValue

export type VendorFilterValues = {
  status: VendorStatusFilter
  countryName: string // free-text location substring; "" means all
  minTotal: string // digits-only string; "" or "0" means no min
}

type VendorFilterProps = {
  onClose: () => void
  onApply: (filters: VendorFilterValues) => void
  initialValues?: VendorFilterValues
}

const DEFAULTS: VendorFilterValues = { status: "all", countryName: "", minTotal: "" }

export default function VendorFilter({ onClose, onApply, initialValues }: VendorFilterProps) {
  const [status, setStatus] = useState<VendorStatusFilter>(initialValues?.status ?? "all")
  const [location, setLocation] = useState<string>(initialValues?.countryName ?? "")
  const [minTotal, setMinTotal] = useState<string>(initialValues?.minTotal ?? "")
  const statusId = useId()
  const locationId = useId()
  const minTotalId = useId()

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
        <FilterFooter
          onReset={handleReset}
          canReset={dirty}
          onCancel={onClose}
          onApply={handleApply}
        />
      }
    >
      <div className={ui.modalSection}>
        <div id={statusId} className={ui.modalSectionHeading}>
          Status Vendor
        </div>
        <div className={ui.field}>
          <div role="group" aria-labelledby={statusId} className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={status === o.value}
                onClick={() => setStatus(o.value)}
                className={chip(status === o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={ui.modalSection}>
        <label htmlFor={locationId} className={`block ${ui.modalSectionHeading}`}>
          Lokasi
        </label>
        <div className={ui.field}>
          <input
            id={locationId}
            type="text"
            placeholder="Ketik lokasi vendor..."
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={`h-11 w-full rounded-md border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-3.5 py-2.5 text-sm text-[#191C1E] outline-none transition ${ui.fieldFocus}`}
          />
        </div>
      </div>

      <div className={ui.modalSection}>
        <label htmlFor={minTotalId} className={`block ${ui.modalSectionHeading}`}>
          Min Total Pembelian
        </label>
        <div className={ui.field}>
          <div className={ui.prefixWrap}>
            <span className={ui.prefixLabel}>IDR</span>
            <input
              id={minTotalId}
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
