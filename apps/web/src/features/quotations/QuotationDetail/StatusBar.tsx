import type { Status } from "@/features/quotations/types";
import { statusConfig } from "./helpers";

interface StatusBarProps {
  status: Status;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (s: Status) => void;
  onSave: () => void;
}

// Status switcher and save action.
export default function StatusBar({ status, isOpen, onToggle, onChange, onSave }: StatusBarProps) {
  const badge = statusConfig[status];
  return (
    <div className="qd-status-bar">
      <div>
        <div className="qd-status-bar-title">Status Quotation</div>
        <div className="qd-status-bar-desc">Ubah status quotation sesuai dengan kondisi aktual.</div>
      </div>
      <div className="qd-status-bar-actions">
        <div style={{ position: "relative" }}>
          <button className="qd-status-trigger" style={{ background: badge.bg, color: badge.color }} onClick={onToggle}>
            {status}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {isOpen && (
            <div className="qd-status-dropdown">
              {(Object.keys(statusConfig) as Status[]).map(s => {
                const isActive = s === status;
                return (
                  <button key={s} className="qd-status-option" onClick={() => onChange(s)}>
                    <span className={isActive ? "qd-status-option--active" : "qd-status-option--label"}>{s}</span>
                    {isActive && (
                      <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                        <path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button className="btn-admin-primary" onClick={onSave}>
          Simpan Data
        </button>
      </div>
    </div>
  );
}
