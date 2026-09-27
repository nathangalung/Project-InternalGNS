import { useId, useState } from "react"
import FilterFooter from "@/components/shared/FilterFooter"
import Modal from "@/components/shared/Modal"
import UnitCombobox from "@/features/units/UnitCombobox"
import {
  STATUS_FILTER_OPTIONS as STATUS_OPTIONS,
  type StatusFilterValue,
} from "@/lib/filter-options"
import { chip, ui } from "@/lib/ui"

export type ProductStatusFilter = StatusFilterValue

export type ProductFilterValues = {
  status: ProductStatusFilter
  unitCode: string // "" means all
}

type ProductFilterProps = {
  onClose: () => void
  onApply: (filters: ProductFilterValues) => void
  initialValues?: ProductFilterValues
}

const DEFAULTS: ProductFilterValues = { status: "all", unitCode: "" }

export default function ProductFilter({ onClose, onApply, initialValues }: ProductFilterProps) {
  const [status, setStatus] = useState<ProductStatusFilter>(initialValues?.status ?? "all")
  const [unitCode, setUnitCode] = useState<string>(initialValues?.unitCode ?? "")
  const [unitQuery, setUnitQuery] = useState<string>(initialValues?.unitCode ?? "")

  const unitHeadingId = useId()

  const dirty = status !== DEFAULTS.status || unitCode !== DEFAULTS.unitCode

  const handleReset = () => {
    setStatus("all")
    setUnitCode("")
    setUnitQuery("")
  }

  const handleApply = () => {
    onApply({ status, unitCode })
    onClose()
  }

  return (
    <Modal
      title="Filter Produk"
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
        <div className={ui.modalSectionHeading}>Status Produk</div>
        <div className={ui.field}>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
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
        <div id={unitHeadingId} className={ui.modalSectionHeading}>
          Satuan
        </div>
        <div className={ui.field}>
          <UnitCombobox
            code={unitCode}
            onCodeChange={setUnitCode}
            query={unitQuery}
            onQueryChange={setUnitQuery}
            placeholder="Ketik nama satuan..."
            aria-labelledby={unitHeadingId}
            inputClassName={`h-11 w-full rounded-md border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-9 py-2.5 font-sans text-sm text-[#191C1E] outline-none transition ${ui.fieldFocus}`}
            panelClassName="max-h-60 border-[rgba(204,195,216,0.4)] py-1"
            leading={
              <svg
                aria-hidden="true"
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
            }
          />
        </div>
      </div>
    </Modal>
  )
}
