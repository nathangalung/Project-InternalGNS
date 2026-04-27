import { confirmModalStyle, confirmOverlayStyle, formatRp } from "./helpers";

interface PriceConfirmModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isBeliChanged: boolean;
  isJualChanged: boolean;
  initialBeli: number | null;
  initialJual: number | null;
  currentBeli: number;
  currentJual: number;
}

// Confirm price changes modal.
export default function PriceConfirmModal({
  open,
  onCancel,
  onConfirm,
  isBeliChanged,
  isJualChanged,
  initialBeli,
  initialJual,
  currentBeli,
  currentJual,
}: PriceConfirmModalProps) {
  if (!open) return null;
  return (
    <div style={confirmOverlayStyle} onClick={onCancel}>
      <div style={confirmModalStyle} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#111827" }}>Konfirmasi Perubahan Harga</h3>
        <p style={{ margin: 0, fontSize: "14px", color: "#4B5563", lineHeight: "1.5" }}>Apakah Anda yakin mengubah:</p>
        <ul style={{ margin: "0", paddingLeft: "20px", fontSize: "14px", color: "#374151" }}>
          {isBeliChanged && initialBeli !== null && (
            <li style={{ marginBottom: "8px" }}>
              Harga beli dari <strong style={{ whiteSpace: "nowrap" }}>Rp{formatRp(initialBeli)}</strong> menjadi <strong style={{ whiteSpace: "nowrap" }}>Rp{formatRp(currentBeli)}</strong>
            </li>
          )}
          {isJualChanged && initialJual !== null && (
            <li>
              Harga jual dari <strong style={{ whiteSpace: "nowrap" }}>Rp{formatRp(initialJual)}</strong> menjadi <strong style={{ whiteSpace: "nowrap" }}>Rp{formatRp(currentJual)}</strong>
            </li>
          )}
        </ul>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "8px" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #D1D5DB", background: "#FFFFFF", color: "#374151", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "none", background: "#630ED4", color: "#FFFFFF", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}
          >
            Iya
          </button>
        </div>
      </div>
    </div>
  );
}
