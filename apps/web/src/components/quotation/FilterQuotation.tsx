import { useState } from "react";

export type DatePreset   = "hari-ini" | "7-hari" | "30-hari" | "kustom";
export type StatusFilter = "Draf" | "Dikirim" | "Ditolak" | "Revisi" | "Disetujui";

interface FilterQuotationProps {
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

/* ── SVG Icons ── */
function IconFilter() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4"  y1="6"  x2="20" y2="6"/>
      <line x1="8"  y1="12" x2="16" y2="12"/>
      <line x1="11" y1="18" x2="13" y2="18"/>
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6"  x2="6"  y2="18"/>
      <line x1="6"  y1="6"  x2="18" y2="18"/>
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="16" y1="2"  x2="16" y2="6"/>
      <line x1="8"  y1="2"  x2="8"  y2="6"/>
      <line x1="3"  y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
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

/* ── Component ── */
export default function FilterQuotation({ onClose, onApply, initialValues }: FilterQuotationProps) {
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────── */}
        {/* bg: --color-bg, border-bottom via admin.css .modal-header */}
        <div className="modal-header">
          <div className="modal-header-left">
            {/* warna icon: --color-primary-700 */}
            <span className="modal-header-icon">
              <IconFilter />
            </span>
            {/* font: --text-h3 (20px) bold — via admin.css .modal-header-left h3 */}
            <h3>Filter Quotation</h3>
          </div>
          {/* hover bg: --color-bg-muted — via admin.css .modal-close-btn */}
          <button className="modal-close-btn" onClick={onClose} title="Tutup">
            <IconClose />
          </button>
        </div>

        {/* ── Body ───────────────────────────────── */}
        {/* gap: --space-8, padding: --space-6 --space-8 — via admin.css .modal-body */}
        <div className="modal-body">

          {/* Rentang Tanggal */}
          <section>
            {/* font: --text-overline (11px) bold uppercase — via admin.css .modal-section-label */}
            <p className="modal-section-label">Rentang Tanggal</p>

            {/* grid 2×2, gap: --space-2 — via admin.css .date-presets */}
            <div className="date-presets">
              {DATE_PRESETS.map(({ key, label }) => (
                <button
                  key={key}
                  /* font: --text-body (14px) medium/bold, border, color token — via .date-preset-btn / .date-preset-btn--active */
                  className={`date-preset-btn${preset === key ? " date-preset-btn--active" : ""}`}
                  onClick={() => setPreset(key)}
                >
                  {label}
                  {/* icon check/calendar di kanan */}
                  {preset === key
                    ? <IconCheck />
                    : key === "kustom" && <span className="icon-calendar"><IconCalendar /></span>}
                </button>
              ))}
            </div>

            {/* grid 2-col, gap: --space-4 — via admin.css .date-inputs */}
            <div className="date-inputs">
              {(["start", "end"] as const).map((side) => (
                <div key={side} className="date-input-group">
                  {/* font: --text-overline, color: --color-text-muted — via admin.css .date-input-group label */}
                  <label>{side === "start" ? "Tanggal Mulai" : "Tanggal Selesai"}</label>
                  {/* bg: --color-bg-muted, font: --text-body medium — via admin.css .date-input-field */}
                  <div className="date-input-field">
                    <IconCalendar />
                    <span>{getDateLabels(preset)[side]}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Status Penawaran */}
          <section>
            <p className="modal-section-label">Status Penawaran</p>
            {/* flex wrap, gap: --space-3 — via admin.css .status-pills */}
            <div className="status-pills">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  /* font: --text-body (14px) semibold
                     inactive bg: --color-bg-muted
                     active bg: --color-primary-50, border: --color-primary-700
                     — via admin.css .status-pill / .status-pill--active */
                  className={`status-pill${activeStatuses.includes(s) ? " status-pill--active" : ""}`}
                  onClick={() => toggleStatus(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </section>

          {/* Rentang Harga */}
          <section>
            <p className="modal-section-label">Rentang Harga</p>
            {/* grid 2-col, gap: --space-4 — via admin.css .price-inputs */}
            <div className="price-inputs">
              {[
                { id: "min", label: "Min Harga", value: minHarga, set: setMinHarga },
                { id: "max", label: "Max Harga", value: maxHarga, set: setMaxHarga },
              ].map(({ id, label, value, set }) => (
                <div key={id} className="price-input-group">
                  {/* font: --text-overline, color: --color-text-muted — via admin.css .price-input-group label */}
                  <label>{label}</label>
                  {/* bg: --color-bg-muted — via admin.css .price-input-field */}
                  <div className="price-input-field">
                    {/* font: --text-body bold, color: #4A4455 — via admin.css .price-input-field span */}
                    <span>IDR</span>
                    {/* font: --text-body bold, color: --color-text — via admin.css .price-input-field input */}
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>

        {/* ── Footer ─────────────────────────────── */}
        {/* bg: --color-bg-muted, padding: --space-6 --space-8 — via admin.css .modal-footer */}
        <div className="modal-footer">
          {/* font: --text-body bold, color: #4A4455 — via admin.css .modal-reset-btn */}
          <button className="modal-reset-btn" onClick={handleReset}>
            <IconReset />
            Hapus Filter
          </button>

          <div className="modal-footer-actions">
            {/* font: --text-body bold, color: --color-primary-700 — via admin.css .btn-modal-cancel */}
            <button className="btn-modal-cancel" onClick={onClose}>
              Batal
            </button>
            {/* font: --text-body bold, bg: --color-primary-700, color: #fff
                shadow: --shadow-lg — via admin.css .btn-modal-apply */}
            <button className="btn-modal-apply" onClick={handleApply}>
              Terapkan
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
