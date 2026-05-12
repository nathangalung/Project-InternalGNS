import { useMemo, useRef, useState } from "react"
import { useCountries } from "@/features/countries/hooks"
import {
  CheckmarkIcon,
  type ClientAddFormData,
  disabledStyle,
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
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
  return (
    <div className="ca-section">
      <div className="ca-section-heading">Identitas Perusahaan</div>
      <div className="ca-row-2">
        <div className="ca-field">
          <label className="ca-label">
            Nama Perusahaan <span className="ca-required">*</span>
          </label>
          <input
            className="ca-input"
            type="text"
            placeholder="Masukkan nama lengkap klien"
            value={form.namaPerusahaan}
            onChange={(e) => onChange("namaPerusahaan", e.target.value)}
          />
        </div>
        <div className="ca-field">
          <label className="ca-label">
            Kode Negara <span className="ca-required">*</span>
          </label>
          <div className="ca-select-wrapper">
            <button
              type="button"
              className="ca-select-btn"
              onClick={() => {
                if (isNamaPerusahaanFilled) setNegaraOpen((o) => !o)
              }}
              disabled={!isNamaPerusahaanFilled}
              style={!isNamaPerusahaanFilled ? disabledStyle : undefined}
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
                <div style={{ padding: "0 12px 8px" }}>
                  <input
                    type="text"
                    placeholder="Cari negara..."
                    value={negaraQuery}
                    onChange={(e) => setNegaraQuery(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      fontFamily: "'Inter', sans-serif",
                      color: "#191C1E",
                      background: "#F7F7F8",
                      border: "1px solid rgba(204, 195, 216, 0.4)",
                      borderRadius: "6px",
                      outline: "none",
                    }}
                  />
                </div>
                {filteredNegaraOptions.length === 0 && (
                  <div
                    style={{
                      padding: "12px 20px",
                      fontSize: "13px",
                      color: "#94A3B8",
                      fontFamily: "'Inter', sans-serif",
                      textAlign: "center",
                    }}
                  >
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
      <div className="ca-field">
        <label className="ca-label">
          Alamat <span className="ca-required">*</span>
        </label>
        <textarea
          className="ca-textarea"
          placeholder="Alamat lengkap operasional (min. 20 karakter)"
          value={form.alamat}
          onChange={(e) => onChange("alamat", e.target.value)}
          rows={3}
          disabled={!isNamaPerusahaanFilled}
          style={!isNamaPerusahaanFilled ? disabledStyle : undefined}
        />
        {alamatError && (
          <span style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px", display: "block" }}>
            {alamatError}
          </span>
        )}
      </div>
      <div className="ca-field">
        <label className="ca-label">
          Logo <span className="ca-optional">(Opsional)</span>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            handleLogoSelect(e.target.files?.[0])
            e.target.value = ""
          }}
        />
        {form.logo ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              padding: "12px",
              background: "#F2F4F6",
              borderRadius: "8px",
            }}
          >
            <img
              src={form.logo}
              alt="Logo klien"
              style={{
                width: "64px",
                height: "64px",
                objectFit: "cover",
                borderRadius: "8px",
                background: "#FFFFFF",
                flexShrink: 0,
              }}
            />
            <div
              style={{
                flex: 1,
                fontFamily: "'Inter', sans-serif",
                fontSize: "13px",
                color: "#4A4455",
              }}
            >
              Logo terpilih
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isNamaPerusahaanFilled}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(204, 195, 216, 0.4)",
                background: "#FFFFFF",
                color: "#4A4455",
                fontFamily: "'Inter', sans-serif",
                fontSize: "12px",
                fontWeight: 600,
                cursor: isNamaPerusahaanFilled ? "pointer" : "not-allowed",
                opacity: isNamaPerusahaanFilled ? 1 : 0.6,
              }}
            >
              Ganti
            </button>
            <button
              type="button"
              onClick={() => onChange("logo", "")}
              disabled={!isNamaPerusahaanFilled}
              style={{
                padding: "8px 14px",
                borderRadius: "8px",
                border: "none",
                background: "transparent",
                color: "#DC2626",
                fontFamily: "'Inter', sans-serif",
                fontSize: "12px",
                fontWeight: 600,
                cursor: isNamaPerusahaanFilled ? "pointer" : "not-allowed",
                opacity: isNamaPerusahaanFilled ? 1 : 0.6,
              }}
            >
              Hapus
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isNamaPerusahaanFilled}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              width: "100%",
              padding: "20px",
              background: "#F7F7F8",
              border: "1.5px dashed rgba(204, 195, 216, 0.6)",
              borderRadius: "8px",
              cursor: isNamaPerusahaanFilled ? "pointer" : "not-allowed",
              opacity: isNamaPerusahaanFilled ? 1 : 0.6,
              fontFamily: "'Inter', sans-serif",
              transition: "all 0.15s",
            }}
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
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#4A4455" }}>
              Unggah logo perusahaan
            </span>
            <span style={{ fontSize: "11px", color: "#94A3B8" }}>
              PNG, JPG, atau SVG · maks 2MB
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
