import { useId, useRef, useState } from "react"
import CountryCombobox from "@/features/countries/CountryCombobox"
import { errorMessage } from "@/lib/errors"
import { ui } from "@/lib/ui"
import { validateAsset } from "@/lib/upload-validation"
import {
  type ClientAddFormData,
  fieldErrorCls,
  fieldHintCls,
  inputCls,
  optionalCls,
} from "./helpers"

type CompanyCardProps = {
  form: ClientAddFormData
  onChange: (field: keyof ClientAddFormData, value: string) => void
  // The picked file, uploaded after save.
  onLogoFile: (file: File | null) => void
  isNamaPerusahaanFilled: boolean
  alamatError: string | null
}

// Company identity card.
export default function CompanyCard({
  form,
  onChange,
  onLogoFile,
  isNamaPerusahaanFilled,
  alamatError,
}: CompanyCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const id = useId()

  // Validate before previewing.
  function handleLogoSelect(file: File | undefined) {
    if (!file) return
    try {
      validateAsset("clientLogo", file)
    } catch (err) {
      setLogoError(errorMessage(err, "Logo tidak valid."))
      return
    }
    setLogoError(null)
    onLogoFile(file)
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") onChange("logo", reader.result)
    }
    reader.readAsDataURL(file)
  }

  const logoActionCls = isNamaPerusahaanFilled ? "cursor-pointer" : "cursor-not-allowed opacity-60"

  return (
    <div className={ui.modalSection}>
      <div className={ui.modalSectionHeading}>Identitas Perusahaan</div>
      <div className={ui.row2}>
        <div className={ui.field}>
          <label htmlFor={`${id}-name`} className={ui.fieldLabel}>
            Nama Perusahaan <span className="text-primary-700">*</span>
          </label>
          <input
            id={`${id}-name`}
            className={inputCls}
            type="text"
            placeholder="Masukkan nama lengkap klien"
            value={form.namaPerusahaan}
            onChange={(e) => onChange("namaPerusahaan", e.target.value)}
          />
        </div>
        <div className={ui.field}>
          <label htmlFor={`${id}-country`} className={ui.fieldLabel}>
            Kode Negara <span className="text-primary-700">*</span>
          </label>
          <CountryCombobox
            code={form.kodeNegara}
            onCodeChange={(code) => onChange("kodeNegara", code)}
            triggerId={`${id}-country`}
            triggerClassName={ui.selectBtn}
            fallback="Pilih Negara"
            disabled={!isNamaPerusahaanFilled}
          />
        </div>
      </div>
      <div className={ui.field}>
        <label htmlFor={`${id}-address`} className={ui.fieldLabel}>
          Alamat <span className={optionalCls}>(Opsional)</span>
        </label>
        <textarea
          id={`${id}-address`}
          className={`${inputCls} resize-none font-sans leading-5`}
          placeholder="Alamat lengkap operasional (min. 20 karakter)"
          value={form.alamat}
          onChange={(e) => onChange("alamat", e.target.value)}
          rows={3}
          disabled={!isNamaPerusahaanFilled}
          aria-invalid={alamatError ? true : undefined}
          aria-describedby={`${id}-address-hint`}
        />
        {alamatError ? (
          <span id={`${id}-address-hint`} className={fieldErrorCls}>
            {alamatError}
          </span>
        ) : (
          <span id={`${id}-address-hint`} className={fieldHintCls}>
            Wajib diisi sebelum PO diproses
          </span>
        )}
      </div>
      <div className={ui.field}>
        <span id={`${id}-logo`} className={ui.fieldLabel}>
          Logo <span className={optionalCls}>(Opsional)</span>
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          aria-labelledby={`${id}-logo`}
          onChange={(e) => {
            handleLogoSelect(e.target.files?.[0])
            e.target.value = ""
          }}
        />
        {form.logo ? (
          <div className="flex items-center gap-4 rounded-md bg-[#F2F4F6] p-3">
            <img
              src={form.logo}
              alt="Logo klien"
              className="h-16 w-16 flex-shrink-0 rounded-md bg-white object-cover"
            />
            <div className="flex-1 font-sans text-[13px] text-[#4A4455]">Logo terpilih</div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isNamaPerusahaanFilled}
              className={`rounded-md border border-[rgba(204,195,216,0.4)] bg-white px-3.5 py-2 font-sans text-xs font-semibold text-[#4A4455] ${logoActionCls} ${ui.focusRing}`}
            >
              Ganti
            </button>
            <button
              type="button"
              onClick={() => {
                onChange("logo", "")
                onLogoFile(null)
              }}
              disabled={!isNamaPerusahaanFilled}
              className={`rounded-md bg-transparent px-3.5 py-2 font-sans text-xs font-semibold text-[#DC2626] ${logoActionCls} ${ui.focusRing}`}
            >
              Hapus
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isNamaPerusahaanFilled}
            className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-[rgba(204,195,216,0.6)] bg-[#F7F7F8] p-5 font-sans transition-all duration-150 ${logoActionCls} ${ui.focusRing}`}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#94A3B8"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span className="text-[13px] font-semibold text-[#4A4455]">Unggah logo perusahaan</span>
            <span className="text-[11px] text-[#94A3B8]">PNG, JPG, WEBP, atau GIF · maks 2MB</span>
          </button>
        )}
        {logoError && (
          <span role="alert" className={fieldErrorCls}>
            {logoError}
          </span>
        )}
      </div>
    </div>
  )
}
