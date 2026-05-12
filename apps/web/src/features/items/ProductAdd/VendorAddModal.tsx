import { confirmModalStyle, confirmOverlayStyle, type NewVendorForm } from "./helpers"

interface VendorAddModalProps {
  open: boolean
  form: NewVendorForm
  onChange: (next: NewVendorForm) => void
  onClose: () => void
  onSubmit: () => void
  isSaving?: boolean
  error?: string | null
}

// New vendor inline modal.
export default function VendorAddModal({
  open,
  form,
  onChange,
  onClose,
  onSubmit,
  isSaving,
  error,
}: VendorAddModalProps) {
  if (!open) return null
  const trimmed = form.nama.trim()
  const disableSubmit = !trimmed || Boolean(isSaving)
  return (
    <div style={confirmOverlayStyle} onClick={onClose}>
      <div style={{ ...confirmModalStyle, maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111827" }}>
            Tambah Vendor Baru
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#6B7280",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 700,
                color: "#6B7280",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              Nama Vendor <span style={{ color: "#EF4444" }}>*</span>
            </label>
            <input
              className="ca-input"
              type="text"
              placeholder="Masukkan nama vendor"
              value={form.nama}
              onChange={(e) => onChange({ ...form, nama: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 700,
                color: "#6B7280",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              Harga Beli (Rp)
            </label>
            <input
              className="ca-input"
              type="number"
              min={0}
              placeholder="Masukkan harga beli"
              value={form.harga}
              onChange={(e) => onChange({ ...form, harga: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>
        </div>
        {error && <div style={{ fontSize: "12px", color: "#EF4444" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
          <button
            onClick={onClose}
            disabled={isSaving}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid #D1D5DB",
              background: "#fff",
              color: "#374151",
              fontWeight: 600,
              fontSize: "14px",
              cursor: isSaving ? "not-allowed" : "pointer",
            }}
          >
            Batal
          </button>
          <button
            onClick={onSubmit}
            disabled={disableSubmit}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background: "#630ED4",
              color: "#fff",
              fontWeight: 600,
              fontSize: "14px",
              cursor: disableSubmit ? "not-allowed" : "pointer",
              opacity: disableSubmit ? 0.5 : 1,
            }}
          >
            {isSaving ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  )
}
