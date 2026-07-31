import { ui } from "@/lib/ui"
import { type ClientAddFormData, fieldErrorCls, inputCls, optionalCls } from "./helpers"

interface ContactCardProps {
  form: ClientAddFormData
  onChange: (field: keyof ClientAddFormData, value: string) => void
  isAlamatFilled: boolean
  isNamaKontakFilled: boolean
  phoneError: string | null
  emailError: string | null
}

// Contact and technical card.
export default function ContactCard({
  form,
  onChange,
  isAlamatFilled,
  isNamaKontakFilled,
  phoneError,
  emailError,
}: ContactCardProps) {
  return (
    <div
      className={`${ui.modalSection} transition-opacity duration-200 ease-[ease] ${
        !isAlamatFilled ? "opacity-60" : "opacity-100"
      }`}
    >
      <div className={ui.modalSectionHeading}>Kontak &amp; Teknis</div>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>
          Nama Narahubung <span className="text-primary-700">*</span>
        </label>
        <input
          className={inputCls}
          type="text"
          placeholder="Nama lengkap kontak"
          value={form.namaKontak}
          onChange={(e) => onChange("namaKontak", e.target.value)}
          disabled={!isAlamatFilled}
        />
      </div>
      <div className={ui.row2}>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>
            Nomor Telepon <span className={optionalCls}>(Opsional)</span>
          </label>
          <div className={ui.prefixWrap}>
            <span className={ui.prefixLabel}>+62</span>
            <input
              className={ui.prefixInput}
              type="tel"
              placeholder="812xxxx"
              value={form.nomorTelepon}
              onChange={(e) => onChange("nomorTelepon", e.target.value)}
              disabled={!isNamaKontakFilled}
            />
          </div>
          {phoneError && <span className={fieldErrorCls}>{phoneError}</span>}
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>
            Email <span className={optionalCls}>(Opsional)</span>
          </label>
          <input
            className={inputCls}
            type="text"
            placeholder="klien@perusahaan.com"
            value={form.email}
            onChange={(e) => onChange("email", e.target.value)}
            disabled={!isNamaKontakFilled}
          />
          {emailError && <span className={fieldErrorCls}>{emailError}</span>}
        </div>
      </div>
    </div>
  )
}
