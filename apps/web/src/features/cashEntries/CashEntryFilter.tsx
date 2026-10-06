import { useId, useState } from "react"
import FilterFooter from "@/components/shared/FilterFooter"
import Modal from "@/components/shared/Modal"
import { chip, ui } from "@/lib/ui"
import {
  CASH_FILTERS,
  type CashFilterValues,
  DIRECTION_LABEL,
  type DirectionFilter,
} from "./helpers"
import { useCashCategories } from "./hooks"

type CashEntryFilterProps = {
  initialValues: CashFilterValues
  onApply: (filters: CashFilterValues) => void
  onClose: () => void
}

const DIRECTIONS: { value: DirectionFilter; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "in", label: DIRECTION_LABEL.in },
  { value: "out", label: DIRECTION_LABEL.out },
]

// Kas Lain filters.
export default function CashEntryFilter({ initialValues, onApply, onClose }: CashEntryFilterProps) {
  const [f, setF] = useState<CashFilterValues>(initialValues)
  const { data: categories } = useCashCategories()
  const id = useId()
  const dirty = JSON.stringify(f) !== JSON.stringify(CASH_FILTERS)

  return (
    <Modal
      title="Filter Kas Lain"
      onClose={onClose}
      footer={
        <FilterFooter
          onReset={() => setF(CASH_FILTERS)}
          canReset={dirty}
          onCancel={onClose}
          onApply={() => {
            onApply({ ...f, category: f.category.trim() })
            onClose()
          }}
        />
      }
    >
      <div className={ui.modalSection}>
        <div id={`${id}-direction`} className={ui.modalSectionHeading}>
          Jenis
        </div>
        <fieldset
          aria-labelledby={`${id}-direction`}
          className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
        >
          {DIRECTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              aria-pressed={f.direction === d.value}
              onClick={() => setF((p) => ({ ...p, direction: d.value }))}
              className={chip(f.direction === d.value)}
            >
              {d.label}
            </button>
          ))}
        </fieldset>
      </div>

      <div className={ui.modalSection}>
        <label htmlFor={`${id}-category`} className={`block ${ui.modalSectionHeading}`}>
          Kategori
        </label>
        <input
          id={`${id}-category`}
          className={`${ui.fieldInput} font-sans`}
          list={`${id}-categories`}
          value={f.category}
          onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))}
        />
        <datalist id={`${id}-categories`}>
          {(categories ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className={`${ui.modalSection} ${ui.row2}`}>
        <div className={ui.field}>
          <label htmlFor={`${id}-from`} className={ui.fieldLabel}>
            Dari Tanggal
          </label>
          <input
            id={`${id}-from`}
            type="date"
            className={`${ui.fieldInput} font-sans`}
            value={f.dateFrom}
            onChange={(e) => setF((p) => ({ ...p, dateFrom: e.target.value }))}
          />
        </div>
        <div className={ui.field}>
          <label htmlFor={`${id}-to`} className={ui.fieldLabel}>
            Sampai Tanggal
          </label>
          <input
            id={`${id}-to`}
            type="date"
            className={`${ui.fieldInput} font-sans`}
            value={f.dateTo}
            onChange={(e) => setF((p) => ({ ...p, dateTo: e.target.value }))}
          />
        </div>
      </div>
    </Modal>
  )
}
