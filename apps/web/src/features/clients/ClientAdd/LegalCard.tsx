import { type ClientAddFormData, disabledStyle } from "./helpers";

interface LegalCardProps {
  form: ClientAddFormData;
  onChange: (field: keyof ClientAddFormData, value: string) => void;
  isNamaKontakFilled: boolean;
}

// Legal identifiers card.
export default function LegalCard({ form, onChange, isNamaKontakFilled }: LegalCardProps) {
  return (
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
            onChange={e => onChange("npwp", e.target.value)}
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
            onChange={e => onChange("tku", e.target.value)}
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
          onChange={e => onChange("referenceNumber", e.target.value)}
          disabled={!isNamaKontakFilled}
          style={!isNamaKontakFilled ? disabledStyle : undefined}
        />
      </div>
    </div>
  );
}
