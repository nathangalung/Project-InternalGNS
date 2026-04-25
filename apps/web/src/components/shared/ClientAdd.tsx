import { useState, type CSSProperties } from "react";

const dropdownPanelStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "#FFFFFF",
  border: "1px solid rgba(204, 195, 216, 0.2)",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  padding: "8px 0",
  zIndex: 50,
};

const dropdownItemStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "10px 20px",
  width: "100%",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
};

function dropdownLabelStyle(active: boolean): CSSProperties {
  return {
    fontFamily: "'Inter', sans-serif",
    fontWeight: active ? 700 : 500,
    fontSize: "14px",
    lineHeight: "20px",
    color: active ? "#630ED4" : "#4A4455",
  };
}

const CheckmarkIcon = () => (
  <svg width="14" height="11" viewBox="0 0 14 11" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export interface ClientAddFormData {
  namaPerusahaan: string;
  kodeNegara: string;
  alamat: string;
  namaKontak: string;
  nomorTelepon: string;
  email: string;
  npwp: string;
  tku: string;
  referenceNumber: string;
}

interface ClientAddProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (data: ClientAddFormData) => void;
}

const NEGARA_OPTIONS = [
  { value: "IDN", label: "IDN - Indonesia" },
  { value: "SGP", label: "SGP - Singapura" },
  { value: "MYS", label: "MYS - Malaysia" },
  { value: "USA", label: "USA - Amerika Serikat" },
];

const INITIAL_FORM: ClientAddFormData = {
  namaPerusahaan: "",
  kodeNegara: "IDN",
  alamat: "",
  namaKontak: "",
  nomorTelepon: "",
  email: "",
  npwp: "",
  tku: "",
  referenceNumber: "",
};

function isValidAddress(s: string): boolean {
  const t = s.trim();
  return t.length >= 20 && /[a-zA-Z]/.test(t);
}

function isValidEmail(s: string): boolean {
  return s.includes("@") && s.split("@").length === 2 && s.split("@")[1].includes(".");
}

function isValidPhone(s: string): boolean {
  const digits = s.replace(/[^0-9]/g, "");
  return digits.length >= 9 && digits.length <= 13;
}

export default function ClientAdd({ open, onOpenChange, onSuccess }: ClientAddProps) {
  const [form, setForm] = useState<ClientAddFormData>(INITIAL_FORM);
  const [negaraOpen, setNegaraOpen] = useState(false);

  if (!open) return null;

  // Logika validasi pengisian berjenjang
  const isNamaPerusahaanFilled = form.namaPerusahaan.trim().length > 0;
  const isAlamatFilled = isNamaPerusahaanFilled && isValidAddress(form.alamat);
  const alamatError = isNamaPerusahaanFilled && form.alamat.trim().length > 0 && !isValidAddress(form.alamat)
    ? "Alamat harus minimal 20 karakter dan mengandung huruf."
    : null;

  // namaKontak wajib, lalu salah satu dari nomorTelepon atau email harus diisi (dan valid)
  const isNamaKontakFilled = isAlamatFilled && form.namaKontak.trim().length > 0;

  const phoneFilledAndValid = form.nomorTelepon.trim().length > 0 && isValidPhone(form.nomorTelepon);
  const emailFilledAndValid = form.email.trim().length > 0 && isValidEmail(form.email);
  const phoneError = isNamaKontakFilled && form.nomorTelepon.trim().length > 0 && !isValidPhone(form.nomorTelepon)
    ? "Nomor telepon harus 9–13 digit angka."
    : null;
  const emailError = isNamaKontakFilled && form.email.trim().length > 0 && !isValidEmail(form.email)
    ? "Format email tidak valid."
    : null;

  const isContactValid = isNamaKontakFilled && (phoneFilledAndValid || emailFilledAndValid);

  // Gaya untuk field yang terkunci
  const disabledStyle: React.CSSProperties = {
    opacity: 0.6,
    cursor: "not-allowed",
    backgroundColor: "#F7F7F8"
  };

  function handleChange(field: keyof ClientAddFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit() {
    onSuccess?.(form);
    setForm(INITIAL_FORM);
    onOpenChange(false);
  }

  function handleCancel() {
    setForm(INITIAL_FORM);
    onOpenChange(false);
  }

  const selectedNegara = NEGARA_OPTIONS.find((n) => n.value === form.kodeNegara);

  return (
    <div className="ca-overlay" onClick={handleCancel}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="ca-header">
          <h2 className="ca-title">Tambah Klien</h2>
          <button className="ca-close-btn" onClick={handleCancel} title="Tutup">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13"/>
              <line x1="13" y1="1" x2="1" y2="13"/>
            </svg>
          </button>
        </div>

        {/* Form Body */}
        <div className="ca-body">

          {/* Identitas Perusahaan */}
          <div className="ca-section">
            <div className="ca-section-heading">Identitas Perusahaan</div>
            <div className="ca-row-2">
              <div className="ca-field">
                <label className="ca-label">Nama Perusahaan <span className="ca-required">*</span></label>
                <input
                  className="ca-input"
                  type="text"
                  placeholder="Masukkan nama lengkap klien"
                  value={form.namaPerusahaan}
                  onChange={(e) => handleChange("namaPerusahaan", e.target.value)}
                />
              </div>
              <div className="ca-field">
                <label className="ca-label">Kode Negara <span className="ca-required">*</span></label>
                <div className="ca-select-wrapper">
                  <button
                    type="button"
                    className="ca-select-btn"
                    onClick={() => { if (isNamaPerusahaanFilled) setNegaraOpen((o) => !o); }}
                    disabled={!isNamaPerusahaanFilled}
                    style={!isNamaPerusahaanFilled ? disabledStyle : undefined}
                  >
                    <span>{selectedNegara?.label ?? "Pilih Negara"}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  {negaraOpen && isNamaPerusahaanFilled && (
                    <div style={dropdownPanelStyle}>
                      {NEGARA_OPTIONS.map((opt) => {
                        const isActive = form.kodeNegara === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            style={dropdownItemStyle}
                            onClick={() => { handleChange("kodeNegara", opt.value); setNegaraOpen(false); }}
                          >
                            <span style={dropdownLabelStyle(isActive)}>{opt.label}</span>
                            {isActive && <CheckmarkIcon />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="ca-field">
              <label className="ca-label">Alamat <span className="ca-required">*</span></label>
              <textarea
                className="ca-textarea"
                placeholder="Alamat lengkap operasional (min. 20 karakter)"
                value={form.alamat}
                onChange={(e) => handleChange("alamat", e.target.value)}
                rows={3}
                disabled={!isNamaPerusahaanFilled}
                style={!isNamaPerusahaanFilled ? disabledStyle : undefined}
              />
              {alamatError && <span style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px", display: "block" }}>{alamatError}</span>}
            </div>
          </div>

          {/* Kontak & Teknis */}
          <div className="ca-section" style={{ opacity: !isAlamatFilled ? 0.6 : 1, transition: "opacity 0.2s ease" }}>
            <div className="ca-section-heading">Kontak &amp; Teknis</div>
            <div className="ca-field">
              <label className="ca-label">Nama Narahubung <span className="ca-required">*</span></label>
              <input
                className="ca-input"
                type="text"
                placeholder="Nama lengkap kontak"
                value={form.namaKontak}
                onChange={(e) => handleChange("namaKontak", e.target.value)}
                disabled={!isAlamatFilled}
                style={!isAlamatFilled ? disabledStyle : undefined}
              />
            </div>
            <div className="ca-row-2">
              <div className="ca-field">
                <label className="ca-label">Nomor Telepon <span className="ca-optional">(Opsional)</span></label>
                <div className="ca-phone-wrapper">
                  <span className="ca-phone-prefix">+62</span>
                  <input
                    className="ca-phone-input"
                    type="tel"
                    placeholder="812xxxx"
                    value={form.nomorTelepon}
                    onChange={(e) => handleChange("nomorTelepon", e.target.value)}
                    disabled={!isNamaKontakFilled}
                    style={!isNamaKontakFilled ? disabledStyle : undefined}
                  />
                </div>
                {phoneError && <span style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px", display: "block" }}>{phoneError}</span>}
              </div>
              <div className="ca-field">
                <label className="ca-label">Email <span className="ca-optional">(Opsional)</span></label>
                <input
                  className="ca-input"
                  type="text"
                  placeholder="klien@perusahaan.com"
                  value={form.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  disabled={!isNamaKontakFilled}
                  style={!isNamaKontakFilled ? disabledStyle : undefined}
                />
                {emailError && <span style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px", display: "block" }}>{emailError}</span>}
              </div>
            </div>
          </div>

          {/* Legalitas */}
          <div className="ca-section" style={{ opacity: !isNamaKontakFilled ? 0.6 : 1, transition: "opacity 0.2s ease" }}>
            <div className="ca-section-heading">Legalitas</div>
            <div className="ca-row-2">
              <div className="ca-field">
                <label className="ca-label">NPWP <span className="ca-optional">(Opsional)</span></label>
                <input
                  className="ca-input"
                  type="text"
                  placeholder="Masukkan NPWP"
                  value={form.npwp}
                  onChange={(e) => handleChange("npwp", e.target.value)}
                  disabled={!isNamaKontakFilled}
                  style={!isNamaKontakFilled ? disabledStyle : undefined}
                />
              </div>
              <div className="ca-field">
                <label className="ca-label">TKU <span className="ca-optional">(Opsional)</span></label>
                <input
                  className="ca-input"
                  type="text"
                  placeholder="Masukkan ID Teknis atau TKU"
                  value={form.tku}
                  onChange={(e) => handleChange("tku", e.target.value)}
                  disabled={!isNamaKontakFilled}
                  style={!isNamaKontakFilled ? disabledStyle : undefined}
                />
              </div>
            </div>
            <div className="ca-field">
              <label className="ca-label">Reference Number <span className="ca-optional">(Opsional)</span></label>
              <input
                className="ca-input"
                type="text"
                placeholder="Masukkan reference number"
                value={form.referenceNumber}
                onChange={(e) => handleChange("referenceNumber", e.target.value)}
                disabled={!isNamaKontakFilled}
                style={!isNamaKontakFilled ? disabledStyle : undefined}
              />
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="ca-footer">
          {isNamaKontakFilled && !isContactValid && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>Isi minimal nomor telepon atau email.</span>
          )}
          <button type="button" className="ca-btn-cancel" onClick={handleCancel}>Batal</button>
          <button
            type="button"
            className="ca-btn-submit"
            onClick={handleSubmit}
            disabled={!isContactValid}
            style={{ opacity: !isContactValid ? 0.5 : 1, cursor: !isContactValid ? "not-allowed" : "pointer" }}
          >
            Simpan Data
          </button>
        </div>

      </div>
    </div>
  );
}