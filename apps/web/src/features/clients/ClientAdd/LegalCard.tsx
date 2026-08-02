import { ui } from "@/lib/ui"
import { type ClientAddFormData, inputCls, optionalCls } from "./helpers"

interface LegalCardProps {
  form: ClientAddFormData
  onChange: (field: keyof ClientAddFormData, value: string) => void
  isNamaKontakFilled: boolean
}

// Legal identifiers card.
export default function LegalCard({ form, onChange, isNamaKontakFilled }: LegalCardProps) {
  return (
    <div
      className={`${ui.modalSection} transition-opacity duration-200 ease-[ease] ${
        !isNamaKontakFilled ? "opacity-60" : "opacity-100"
      }`}
    >
      <div className={ui.modalSectionHeading}>Legalitas</div>
      <div className={ui.row2}>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>
            NPWP <span className={optionalCls}>(Opsional)</span>
          </label>
          <input
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
          <label className={ui.fieldLabel}>
            TKU <span className={optionalCls}>(Opsional)</span>
          </label>
          <input
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
      <div className={ui.field}>
        <label className={ui.fieldLabel}>
          Reference Number <span className={optionalCls}>(Opsional)</span>
        </label>
        <input
          className={inputCls}
          type="text"
          placeholder="Masukkan reference number"
          value={form.referenceNumber}
          onChange={(e) => onChange("referenceNumber", e.target.value)}
          disabled={!isNamaKontakFilled}
        />
      </div>
    </div>
  )
}
