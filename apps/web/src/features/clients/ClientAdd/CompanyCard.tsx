import { useMemo, useRef, useState } from "react"
import { useCountries } from "@/features/countries/hooks"
import { ui } from "@/lib/ui"
import {
  CheckmarkIcon,
  type ClientAddFormData,
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
  fieldErrorCls,
  inputCls,
  optionalCls,
} from "./helpers"

interface CompanyCardProps {
  form: ClientAddFormData
  onChange: (field: keyof ClientAddFormData, value: string) => void
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

  function handleLogoSelect(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/")) return
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
          <label className={ui.fieldLabel}>
            Nama Perusahaan <span className="text-primary-700">*</span>
          </label>
          <input
            className={inputCls}
            type="text"
            placeholder="Masukkan nama lengkap klien"
            value={form.namaPerusahaan}
            onChange={(e) => onChange("namaPerusahaan", e.target.value)}
          />
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>
            Kode Negara <span className="text-primary-700">*</span>
          </label>
          <div className="relative">
            <button
              type="button"
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
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {negaraOpen && isNamaPerusahaanFilled && (
              <div style={dropdownPanelStyle}>
                <div className="px-3 pb-2">
                  <input
                    type="text"
                    placeholder="Cari negara..."
                    value={negaraQuery}
                    onChange={(e) => setNegaraQuery(e.target.value)}
                    className="w-full rounded-sm border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-3 py-2 font-sans text-[13px] text-[#191C1E] outline-none"
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
                      style={dropdownItemStyle}
                      onClick={() => {
                        onChange("kodeNegara", opt.value)
                        setNegaraQuery("")
                        closeNegara()
                      }}
                    >
                      <span style={dropdownLabelStyle(isActive)}>{opt.label}</span>
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
        <label className={ui.fieldLabel}>
          Alamat <span className="text-primary-700">*</span>
        </label>
        <textarea
          className={`${inputCls} resize-none leading-5`}
          placeholder="Alamat lengkap operasional (min. 20 karakter)"
          value={form.alamat}
          onChange={(e) => onChange("alamat", e.target.value)}
          rows={3}
          disabled={!isNamaPerusahaanFilled}
        />
        {alamatError && <span className={fieldErrorCls}>{alamatError}</span>}
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>
          Logo <span className={optionalCls}>(Opsional)</span>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
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
              className={`rounded-md border border-[rgba(204,195,216,0.4)] bg-white px-3.5 py-2 font-sans text-xs font-semibold text-[#4A4455] ${logoActionCls}`}
            >
              Ganti
            </button>
            <button
              type="button"
              onClick={() => onChange("logo", "")}
              disabled={!isNamaPerusahaanFilled}
              className={`rounded-md bg-transparent px-3.5 py-2 font-sans text-xs font-semibold text-[#DC2626] ${logoActionCls}`}
            >
              Hapus
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isNamaPerusahaanFilled}
            className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-[rgba(204,195,216,0.6)] bg-[#F7F7F8] p-5 font-sans transition-all duration-150 ${logoActionCls}`}
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
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span className="text-[13px] font-semibold text-[#4A4455]">Unggah logo perusahaan</span>
            <span className="text-[11px] text-[#94A3B8]">PNG, JPG, atau SVG · maks 2MB</span>
          </button>
        )}
      </div>
    </div>
  )
}
