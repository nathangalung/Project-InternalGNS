import { useId, useMemo, useRef, useState } from "react"
import { useCountries } from "@/features/countries/hooks"
import { dropdownLabel, ui } from "@/lib/ui"
import { validateAsset } from "@/lib/upload-validation"
import {
  CheckmarkIcon,
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
  negaraOpen: boolean
  setNegaraOpen: (fn: (o: boolean) => boolean) => void
  closeNegara: () => void
}

// Company identity card.
export default function CompanyCard({
  form,
  onChange,
  onLogoFile,
  isNamaPerusahaanFilled,
  alamatError,
  negaraOpen,
  setNegaraOpen,
  closeNegara,
}: CompanyCardProps) {
  const { data: countries } = useCountries()
  const [negaraQuery, setNegaraQuery] = useState("")
  const negaraOptions = useMemo(
    () => (countries ?? []).map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` })),
    [countries],
  )
  const filteredNegaraOptions = useMemo(() => {
    const q = negaraQuery.trim().toLowerCase()
    if (!q) return negaraOptions.slice(0, 5)
    return negaraOptions.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 5)
  }, [negaraOptions, negaraQuery])
  const selectedNegara = negaraOptions.find((n) => n.value === form.kodeNegara)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const id = useId()

  // Validate before previewing.
  function handleLogoSelect(file: File | undefined) {
    if (!file) return
    try {
      validateAsset("clientLogo", file)
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Logo tidak valid.")
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
          <div className="relative">
            <button
              type="button"
              id={`${id}-country`}
              aria-haspopup="listbox"
              aria-expanded={negaraOpen && isNamaPerusahaanFilled}
              className={ui.selectBtn}
              onClick={() => {
                if (isNamaPerusahaanFilled) setNegaraOpen((o) => !o)
              }}
              disabled={!isNamaPerusahaanFilled}
            >
              <span>{selectedNegara?.label ?? "Pilih Negara"}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {negaraOpen && isNamaPerusahaanFilled && (
              <div className={ui.dropdownPanel}>
                <div className="px-3 pb-2">
                  <input
                    type="text"
                    placeholder="Cari negara..."
                    aria-label="Cari negara"
                    value={negaraQuery}
                    onChange={(e) => setNegaraQuery(e.target.value)}
                    className={`w-full rounded-sm border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-3 py-2 font-sans text-[13px] text-[#191C1E] outline-none transition ${ui.fieldFocus}`}
                  />
                </div>
                {filteredNegaraOptions.length === 0 && (
                  <div className="px-5 py-3 text-center font-sans text-[13px] text-[#94A3B8]">
                    Tidak ada hasil
                  </div>
                )}
                {filteredNegaraOptions.map((opt) => {
                  const isActive = form.kodeNegara === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={ui.dropdownItem}
                      onClick={() => {
                        onChange("kodeNegara", opt.value)
                        setNegaraQuery("")
                        closeNegara()
                      }}
                    >
                      <span className={dropdownLabel(isActive)}>{opt.label}</span>
                      {isActive && <CheckmarkIcon />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
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
