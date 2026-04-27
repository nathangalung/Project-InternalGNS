import { useMemo, useState, type CSSProperties } from "react";
import { useUnits } from "@/features/units/hooks";
import { useCreateItem } from "@/features/items/hooks";

export interface ProductCreateModalData {
  nama: string;
  kode: string;
  satuan: string;
  aktif: boolean;
}

interface ProductCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (data: ProductCreateModalData) => void;
}

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

export default function ProductCreateModal({ open, onOpenChange, onSuccess }: ProductCreateModalProps) {
  const [nama, setNama] = useState("");
  const [kode, setKode] = useState("");
  const [satuan, setSatuan] = useState("");
  const [aktif, setAktif] = useState(true);
  const [satuanOpen, setSatuanOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: units } = useUnits();
  const satuanOptions = useMemo(() => (units ?? []).map(u => u.code), [units]);
  const createItem = useCreateItem();

  if (!open) return null;

  const isValid = nama.trim().length > 0;

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitError(null);
    const unit = units?.find(u => u.code === satuan);
    try {
      await createItem.mutateAsync({
        name: nama.trim(),
        impaCode: kode.trim() || undefined,
        defaultUnitId: unit?.id,
      });
      onSuccess?.({ nama: nama.trim(), kode: kode.trim(), satuan, aktif });
      reset();
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Gagal menyimpan produk.");
    }
  }

  function handleCancel() {
    reset();
    onOpenChange(false);
  }

  function reset() {
    setNama("");
    setKode("");
    setSatuan("");
    setAktif(true);
    setSatuanOpen(false);
    setSubmitError(null);
  }

  return (
    <div className="ca-overlay" onClick={handleCancel}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="ca-header">
          <h2 className="ca-title">Tambah Produk Baru</h2>
          <button className="ca-close-btn" onClick={handleCancel} title="Tutup">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13"/>
              <line x1="13" y1="1" x2="1" y2="13"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="ca-body">
          <div className="ca-section">

            {/* Nama Produk */}
            <div className="ca-field">
              <label className="ca-label">
                Nama Produk <span className="ca-required">*</span>
              </label>
              <input
                className="ca-input"
                type="text"
                placeholder="Masukkan nama produk..."
                value={nama}
                onChange={(e) => setNama(e.target.value)}
              />
            </div>

            {/* Kode IMPA */}
            <div className="ca-field">
              <label className="ca-label">Kode IMPA</label>
              <input
                className="ca-input"
                type="text"
                placeholder="Contoh: 330212"
                value={kode}
                onChange={(e) => setKode(e.target.value)}
              />
            </div>

            {/* Satuan Default */}
            <div className="ca-field">
              <label className="ca-label">Satuan Default</label>
              <div className="ca-select-wrapper">
                <button
                  type="button"
                  className="ca-select-btn"
                  onClick={() => setSatuanOpen((o) => !o)}
                >
                  <span>{satuan || "Pilih satuan"}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {satuanOpen && (
                  <div style={dropdownPanelStyle}>
                    {satuanOptions.map((opt) => {
                      const isActive = satuan === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          style={dropdownItemStyle}
                          onClick={() => { setSatuan(opt); setSatuanOpen(false); }}
                        >
                          <span style={dropdownLabelStyle(isActive)}>{opt}</span>
                          {isActive && <CheckmarkIcon />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Status Produk */}
            <div className="ca-field" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <label className="ca-label" style={{ margin: 0 }}>Status Produk</label>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 700,
                  fontSize: "12px",
                  color: aktif ? "#630ED4" : "#9CA3AF",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}>
                  {aktif ? "AKTIF" : "NONAKTIF"}
                </span>
                <button
                  type="button"
                  onClick={() => setAktif((a) => !a)}
                  role="switch"
                  aria-checked={aktif}
                  style={{
                    width: "40px",
                    height: "22px",
                    borderRadius: "11px",
                    border: "none",
                    background: aktif ? "#630ED4" : "#D1D5DB",
                    cursor: "pointer",
                    position: "relative",
                    transition: "background 0.2s",
                    flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: "absolute",
                    top: "3px",
                    left: aktif ? "21px" : "3px",
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    background: "#FFFFFF",
                    transition: "left 0.2s",
                  }} />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="ca-footer">
          {submitError && (
            <span style={{ fontSize: "12px", color: "#EF4444", flex: 1 }}>{submitError}</span>
          )}
          <button type="button" className="ca-btn-cancel" onClick={handleCancel} disabled={createItem.isPending}>Batal</button>
          <button
            type="button"
            className="ca-btn-submit"
            onClick={handleSubmit}
            disabled={!isValid || createItem.isPending}
            style={{ opacity: !isValid || createItem.isPending ? 0.5 : 1, cursor: !isValid || createItem.isPending ? "not-allowed" : "pointer" }}
          >
            {createItem.isPending ? "Menyimpan..." : "Tambahkan"}
          </button>
        </div>

      </div>
    </div>
  );
}
