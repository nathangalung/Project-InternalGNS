import { useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { todayInJakarta } from "@/lib/date-range"
import { isVersionConflict } from "@/lib/errors"
import { formErrors } from "@/lib/form-errors"
import { chip, ui } from "@/lib/ui"
import type { CashEntryRow } from "@/types/api"
import {
  amountShown,
  amountTyped,
  type CashFieldErrors,
  type CashForm,
  cashFieldErrors,
  cashFormFromRow,
  cashInput,
  DIRECTION_LABEL,
  emptyCashForm,
} from "./helpers"
import { useCashCategories, useSaveCashEntry } from "./hooks"

type CashEntryModalProps = {
  // Absent when adding
  entry?: CashEntryRow
  onClose: () => void
}

const FIELDS = ["entryDate", "direction", "category", "amount", "description"] as const

const STALE =
  "Catatan ini baru saja diubah orang lain. Tutup lalu buka lagi untuk melihat yang terbaru."

const fieldError = "text-[12px] text-error"

// Add or edit one entry.
export default function CashEntryModal({ entry, onClose }: CashEntryModalProps) {
  const [form, setForm] = useState<CashForm>(() =>
    entry ? cashFormFromRow(entry) : emptyCashForm(todayInJakarta()),
  )
  const [errors, setErrors] = useState<CashFieldErrors>({})
  const [banner, setBanner] = useState<string | null>(null)
  const save = useSaveCashEntry()
  const { data: categories } = useCashCategories()
  const id = useId()

  function set<K extends keyof CashForm>(key: K, value: CashForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function submit() {
    const found = cashFieldErrors(form)
    setErrors(found)
    setBanner(null)
    if (Object.keys(found).length > 0) return
    try {
      const input = cashInput(form)
      await save.mutateAsync(
        entry ? { id: entry.id, rowVersion: entry.rowVersion, input } : { input },
      )
      onClose()
    } catch (err) {
      if (isVersionConflict(err)) {
        setBanner(STALE)
        return
      }
      const split = formErrors(err, FIELDS, "Gagal menyimpan catatan kas.")
      setErrors(split.fields)
      setBanner(split.banner)
    }
  }

  const describedBy = (key: keyof CashForm) => (errors[key] ? `${id}-${key}-error` : undefined)

  return (
    <Modal
      title={entry ? "Ubah Catatan Kas" : "Tambah Catatan Kas"}
      onClose={() => !save.isPending && onClose()}
      footer={
        <>
          {banner && (
            <span role="alert" className="flex-1 text-[12px] text-error">
              {banner}
            </span>
          )}
          <div className="flex gap-4 max-sm:w-full max-sm:*:flex-1 max-sm:*:px-4">
            <button
              type="button"
              className={ui.modalCancel}
              onClick={onClose}
              disabled={save.isPending}
            >
              Batal
            </button>
            <button
              type="button"
              className={ui.modalSubmit}
              onClick={() => void submit()}
              disabled={save.isPending}
            >
              {save.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div id={`${id}-direction`} className={ui.modalSectionHeading}>
          Jenis <span className="text-primary-700">*</span>
        </div>
        <div className={ui.field}>
          <fieldset
            aria-labelledby={`${id}-direction`}
            aria-describedby={describedBy("direction")}
            className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
          >
            {(["in", "out"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={form.direction === d}
                onClick={() => set("direction", d)}
                className={chip(form.direction === d)}
              >
                {DIRECTION_LABEL[d]}
              </button>
            ))}
          </fieldset>
          {errors.direction && (
            <p id={`${id}-direction-error`} className={fieldError}>
              {errors.direction}
            </p>
          )}
        </div>
      </div>

      <div className={`${ui.modalSection} ${ui.row2}`}>
        <div className={ui.field}>
          <label htmlFor={`${id}-date`} className={ui.fieldLabel}>
            Tanggal <span className="text-primary-700">*</span>
          </label>
          <input
            id={`${id}-date`}
            type="date"
            className={`${ui.fieldInput} font-sans`}
            value={form.entryDate}
            onChange={(e) => set("entryDate", e.target.value)}
            aria-invalid={errors.entryDate ? true : undefined}
            aria-describedby={describedBy("entryDate")}
          />
          {errors.entryDate && (
            <p id={`${id}-entryDate-error`} className={fieldError}>
              {errors.entryDate}
            </p>
          )}
        </div>
        <div className={ui.field}>
          <label htmlFor={`${id}-amount`} className={ui.fieldLabel}>
            Jumlah <span className="text-primary-700">*</span>
          </label>
          <div className={ui.prefixWrap}>
            <span className={ui.prefixLabel}>IDR</span>
            <input
              id={`${id}-amount`}
              className={ui.prefixInput}
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={amountShown(form.amount)}
              onChange={(e) => set("amount", amountTyped(e.target.value))}
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={describedBy("amount")}
            />
          </div>
          {errors.amount && (
            <p id={`${id}-amount-error`} className={fieldError}>
              {errors.amount}
            </p>
          )}
        </div>
      </div>

      <div className={ui.modalSection}>
        <div className={ui.field}>
          <label htmlFor={`${id}-category`} className={ui.fieldLabel}>
            Kategori <span className="text-primary-700">*</span>
          </label>
          <input
            id={`${id}-category`}
            className={`${ui.fieldInput} font-sans`}
            list={`${id}-categories`}
            maxLength={60}
            placeholder="Contoh: Sewa Kantor"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={describedBy("category")}
          />
          <datalist id={`${id}-categories`}>
            {(categories ?? []).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {errors.category && (
            <p id={`${id}-category-error`} className={fieldError}>
              {errors.category}
            </p>
          )}
        </div>
      </div>

      <div className={ui.modalSection}>
        <div className={ui.field}>
          <label htmlFor={`${id}-description`} className={ui.fieldLabel}>
            Keterangan <span className="text-primary-700">*</span>
          </label>
          <textarea
            id={`${id}-description`}
            className={`${ui.fieldInput} min-h-24 font-sans`}
            maxLength={500}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={describedBy("description")}
          />
          {errors.description && (
            <p id={`${id}-description-error`} className={fieldError}>
              {errors.description}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
