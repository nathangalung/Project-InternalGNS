import { useId } from "react"
import { ui } from "@/lib/ui"
import { type ClientAddFormData, inputCls, optionalCls } from "./helpers"

type LegalCardProps = {
  form: ClientAddFormData
  onChange: (field: keyof ClientAddFormData, value: string) => void
  isNamaKontakFilled: boolean
}

// Legal identifiers card.
export default function LegalCard({ form, onChange, isNamaKontakFilled }: LegalCardProps) {
  const id = useId()
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
            inputMode="numeric"
            placeholder="Masukkan NPWP"
            value={form.npwp}
            onChange={(e) => onChange("npwp", e.target.value.replace(/\D/g, ""))}
            disabled={!isNamaKontakFilled}
          />
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
            onChange={(e) => onChange("tku", e.target.value.replace(/\D/g, ""))}
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
