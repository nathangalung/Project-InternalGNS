import { useMemo } from "react";
import {
  CheckmarkIcon,
  type ClientAddFormData,
  disabledStyle,
  dropdownItemStyle,
  dropdownLabelStyle,
  dropdownPanelStyle,
} from "./helpers";
import { useCountries } from "@/features/countries/hooks";

interface CompanyCardProps {
  form: ClientAddFormData;
  onChange: (field: keyof ClientAddFormData, value: string) => void;
  isNamaPerusahaanFilled: boolean;
  alamatError: string | null;
  negaraOpen: boolean;
  setNegaraOpen: (fn: (o: boolean) => boolean) => void;
  closeNegara: () => void;
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
  const { data: countries } = useCountries();
  const negaraOptions = useMemo(
    () => (countries ?? []).map(c => ({ value: c.code, label: `${c.code} - ${c.name}` })),
    [countries],
  );
  const selectedNegara = negaraOptions.find(n => n.value === form.kodeNegara);
  return (
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
            onChange={e => onChange("namaPerusahaan", e.target.value)}
          />
        </div>
        <div className="ca-field">
          <label className="ca-label">Kode Negara <span className="ca-required">*</span></label>
          <div className="ca-select-wrapper">
            <button
              type="button"
              className="ca-select-btn"
              onClick={() => { if (isNamaPerusahaanFilled) setNegaraOpen(o => !o); }}
              disabled={!isNamaPerusahaanFilled}
              style={!isNamaPerusahaanFilled ? disabledStyle : undefined}
            >
              <span>{selectedNegara?.label ?? "Pilih Negara"}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {negaraOpen && isNamaPerusahaanFilled && (
              <div style={dropdownPanelStyle}>
                {negaraOptions.map(opt => {
                  const isActive = form.kodeNegara === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      style={dropdownItemStyle}
                      onClick={() => { onChange("kodeNegara", opt.value); closeNegara(); }}
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
          onChange={e => onChange("alamat", e.target.value)}
          rows={3}
          disabled={!isNamaPerusahaanFilled}
          style={!isNamaPerusahaanFilled ? disabledStyle : undefined}
        />
        {alamatError && <span style={{ fontSize: "12px", color: "#EF4444", marginTop: "4px", display: "block" }}>{alamatError}</span>}
      </div>
    </div>
  );
}
