import { type ClientAddFormData, disabledStyle } from "./helpers"

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
      className="ca-section"
      style={{ opacity: !isAlamatFilled ? 0.6 : 1, transition: "opacity 0.2s ease" }}
    >
      <div className="ca-section-heading">Kontak &amp; Teknis</div>
      <div className="ca-field">
        <label className="ca-label">
          Nama Narahubung <span className="ca-required">*</span>
        </label>
        <input
          className="ca-input"
          type="text"
          placeholder="Nama lengkap kontak"
          value={form.namaKontak}
          onChange={(e) => onChange("namaKontak", e.target.value)}
          disabled={!isAlamatFilled}
          style={!isAlamatFilled ? disabledStyle : undefined}
        />
      </div>
      <div className="ca-row-2">
        <div className="ca-field">
          <label className="ca-label">
            Nomor Telepon <span className="ca-optional">(Opsional)</span>
          </label>
          <div className="ca-phone-wrapper">
            <span className="ca-phone-prefix">+62</span>
            <input
              className="ca-phone-input"
              type="tel"
              placeholder="812xxxx"
              value={form.nomorTelepon}
              onChange={(e) => onChange("nomorTelepon", e.target.value)}
              disabled={!isNamaKontakFilled}
              style={!isNamaKontakFilled ? disabledStyle : undefined}
            />
          </div>
          {phoneError && (
            <span
              style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px", display: "block" }}
            >
              {phoneError}
            </span>
          )}
        </div>
        <div className="ca-field">
          <label className="ca-label">
            Email <span className="ca-optional">(Opsional)</span>
          </label>
          <input
            className="ca-input"
            type="text"
            placeholder="klien@perusahaan.com"
            value={form.email}
            onChange={(e) => onChange("email", e.target.value)}
            disabled={!isNamaKontakFilled}
            style={!isNamaKontakFilled ? disabledStyle : undefined}
          />
          {emailError && (
            <span
              style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px", display: "block" }}
            >
              {emailError}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
