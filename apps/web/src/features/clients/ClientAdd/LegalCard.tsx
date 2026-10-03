import { useId } from "react"
import { ui } from "@/lib/ui"
import { digitsOnly } from "@/lib/validation"
import { type ClientAddFormData, fieldErrorCls, inputCls, optionalCls } from "./helpers"

type LegalCardProps = {
  form: ClientAddFormData
  onChange: (field: keyof ClientAddFormData, value: string) => void
  isNamaKontakFilled: boolean
  npwpError: string | null
}

// Legal identifiers card.
export default function LegalCard({
  form,
  onChange,
  isNamaKontakFilled,
  npwpError,
}: LegalCardProps) {
  const id = useId()
  // A foreign buyer's tax id may hold letters; an Indonesian NPWP is digits.
  const indonesian = form.kodeNegara === "" || form.kodeNegara.toUpperCase() === "IDN"
  return (
    <div
      className={`${ui.modalSection} transition-opacity duration-200 ease-[ease] ${
        !isNamaKontakFilled ? "opacity-60" : "opacity-100"
      }`}
    >
      <div className={ui.modalSectionHeading}>Legalitas</div>
      <div className={ui.row2}>
        <div className={ui.field}>
          <label htmlFor={`${id}-npwp`} className={ui.fieldLabel}>
            NPWP <span className={optionalCls}>(Opsional)</span>
          </label>
          <input
            id={`${id}-npwp`}
            className={inputCls}
            type="text"
            inputMode={indonesian ? "numeric" : "text"}
            placeholder={indonesian ? "16 digit NPWP" : "Nomor pajak pembeli"}
            value={form.npwp}
            onChange={(e) =>
              onChange("npwp", indonesian ? digitsOnly(e.target.value) : e.target.value)
            }
            disabled={!isNamaKontakFilled}
            aria-invalid={npwpError ? true : undefined}
          />
          {npwpError && <span className={fieldErrorCls}>{npwpError}</span>}
        </div>
        <div className={ui.field}>
          <label htmlFor={`${id}-tku`} className={ui.fieldLabel}>
            TKU <span className={optionalCls}>(Opsional)</span>
          </label>
          <input
            id={`${id}-tku`}
            className={inputCls}
            type="text"
            inputMode="numeric"
            placeholder="Masukkan ID Teknis atau TKU"
            value={form.tku}
            onChange={(e) => onChange("tku", digitsOnly(e.target.value))}
            disabled={!isNamaKontakFilled}
          />
        </div>
      </div>
      <p className="text-xs leading-5 text-dark-500">
        Nomor klien 4 digit diberikan otomatis setelah data disimpan.
      </p>
    </div>
  )
}
