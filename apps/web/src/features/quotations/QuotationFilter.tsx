import { useState } from "react";

export type DatePreset   = "hari-ini" | "7-hari" | "30-hari" | "kustom";
export type StatusFilter = "Draf" | "Dikirim" | "Ditolak" | "Revisi" | "Disetujui";

interface QuotationFilterProps {
  onClose: () => void;
  onApply?: (filters: {
    preset: DatePreset;
    statuses: StatusFilter[];
    minHarga: string;
    maxHarga: string;
  }) => void;
  initialValues?: {
    preset: DatePreset;
    statuses: StatusFilter[];
    minHarga: string;
    maxHarga: string;
  };
}

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "hari-ini", label: "Hari Ini" },
  { key: "7-hari",   label: "7 Hari Terakhir" },
  { key: "30-hari",  label: "30 Hari Terakhir" },
  { key: "kustom",   label: "Kustom" },
];

const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];
const fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2,"0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

function getDateLabels(preset: DatePreset): { start: string; end: string } {
  const today = new Date();
  const end   = fmtDate(today);
  if (preset === "hari-ini") return { start: end, end };
  const start = new Date(today);
  start.setDate(today.getDate() - (preset === "7-hari" ? 7 : 30));
  return { start: fmtDate(start), end };
}

const STATUSES: StatusFilter[] = ["Draf", "Dikirim", "Ditolak", "Revisi", "Disetujui"];

function IconCalendar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8"  y1="2" x2="8"  y2="6"/>
      <line x1="3"  y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function IconReset() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-3.6"/>
    </svg>
  );
}

export default function QuotationFilter({ onClose, onApply, initialValues }: QuotationFilterProps) {
  const [preset,         setPreset]         = useState<DatePreset>(initialValues?.preset ?? "30-hari");
  const [activeStatuses, setActiveStatuses] = useState<StatusFilter[]>(initialValues?.statuses ?? ["Draf"]);
  const [minHarga,       setMinHarga]       = useState(initialValues?.minHarga ?? "0");
  const [maxHarga,       setMaxHarga]       = useState(initialValues?.maxHarga ?? "500.000.000");

  const toggleStatus = (s: StatusFilter) =>
    setActiveStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );

  const handleReset = () => {
    setPreset("30-hari");
    setActiveStatuses([]);
    setMinHarga("0");
    setMaxHarga("500.000.000");
  };

  const handleApply = () => {
    onApply?.({ preset, statuses: activeStatuses, minHarga, maxHarga });
    onClose();
  };

  const dateLabels = getDateLabels(preset);

  return (
    <div className="ca-overlay" onClick={onClose}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="ca-header">
          <h2 className="ca-title">Filter Quotation</h2>
          <button className="ca-close-btn" onClick={onClose} title="Tutup">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13"/>
              <line x1="13" y1="1" x2="1" y2="13"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="ca-body">

          {/* Rentang Tanggal */}
          <div className="ca-section">
            <div className="ca-section-heading">Rentang Tanggal</div>

            <div className="ca-field">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {DATE_PRESETS.map(({ key, label }) => {
                  const isActive = preset === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPreset(key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: isActive ? "1.5px solid #630ED4" : "1px solid rgba(204, 195, 216, 0.4)",
                        background: isActive ? "rgba(99, 14, 212, 0.05)" : "#F7F7F8",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: isActive ? 700 : 500,
                        fontSize: "13px",
                        color: isActive ? "#630ED4" : "#4A4455",
                        transition: "all 0.15s",
                      }}
                    >
                      {label}
                      {key === "kustom"
                        ? <span style={{ color: isActive ? "#630ED4" : "#9CA3AF" }}><IconCalendar /></span>
                        : isActive
                          ? <svg width="14" height="11" viewBox="0 0 14 11" fill="none"><path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          : null
                      }
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="ca-row-2">
              {(["start", "end"] as const).map((side) => (
                <div className="ca-field" key={side}>
                  <label className="ca-label">{side === "start" ? "Tanggal Mulai" : "Tanggal Selesai"}</label>
                  <div className="ca-input" style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "default", color: "#4A4455" }}>
                    <span style={{ color: "#9CA3AF", flexShrink: 0 }}><IconCalendar /></span>
                    <span style={{ fontSize: "13px", fontWeight: 500 }}>{dateLabels[side]}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Status Penawaran */}
          <div className="ca-section">
            <div className="ca-section-heading">Status Penawaran</div>
            <div className="ca-field">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {STATUSES.map((s) => {
                  const isActive = activeStatuses.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleStatus(s)}
                      style={{
                        padding: "6px 16px",
                        borderRadius: "20px",
                        border: isActive ? "1.5px solid #630ED4" : "1px solid rgba(204, 195, 216, 0.4)",
                        background: isActive ? "rgba(99, 14, 212, 0.07)" : "#F7F7F8",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: isActive ? 700 : 500,
                        fontSize: "13px",
                        color: isActive ? "#630ED4" : "#4A4455",
                        transition: "all 0.15s",
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Rentang Harga */}
          <div className="ca-section">
            <div className="ca-section-heading">Rentang Harga</div>
            <div className="ca-row-2">
              {[
                { label: "Min Harga", value: minHarga, set: setMinHarga },
                { label: "Max Harga", value: maxHarga, set: setMaxHarga },
              ].map(({ label, value, set }) => (
                <div className="ca-field" key={label}>
                  <label className="ca-label">{label}</label>
                  <div className="ca-phone-wrapper">
                    <span className="ca-phone-prefix">IDR</span>
                    <input
                      className="ca-phone-input"
                      type="text"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="ca-footer" style={{ justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={handleReset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 600,
              fontSize: "14px",
              color: "#4A4455",
              padding: "0",
            }}
          >
            <IconReset />
            Hapus Filter
          </button>
          <div style={{ display: "flex", gap: "12px" }}>
            <button type="button" className="ca-btn-cancel" onClick={onClose}>Batal</button>
            <button type="button" className="ca-btn-submit" onClick={handleApply}>Terapkan</button>
          </div>
        </div>

      </div>
    </div>
  );
}
