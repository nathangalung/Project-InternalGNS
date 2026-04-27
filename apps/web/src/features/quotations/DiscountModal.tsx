import { useState, useEffect } from "react";

interface DiscountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDiscount: number;
  onSuccess: (discount: number) => void;
}

export default function DiscountModal({ open, onOpenChange, initialDiscount, onSuccess }: DiscountModalProps) {
  const [tempDiscount, setTempDiscount] = useState<string>("");

  // Sync input on open.
  useEffect(() => {
    if (open) {
      setTempDiscount(initialDiscount > 0 ? String(initialDiscount) : "");
    }
  }, [open, initialDiscount]);

  if (!open) return null;

  function handleSaveDiscount() {
    const val = parseFloat(tempDiscount);
    onSuccess(isNaN(val) || val < 0 ? 0 : val);
  }

  return (
    <div className="ca-overlay" onClick={() => onOpenChange(false)} style={{ zIndex: 9999 }}>
      <div className="ca-modal" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "520px", padding: 0, overflow: "hidden", borderRadius: "12px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)" }}>
        
        {/* Header Pop-Up */}
        <div style={{ padding: "24px 24px 16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", margin: 0, fontFamily: "'Inter', sans-serif" }}>Tambah Diskon Pembayaran</h2>
          <button onClick={() => onOpenChange(false)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Body Pop-Up */}
        <div style={{ padding: "0 24px 32px 24px", fontFamily: "'Inter', sans-serif" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#630ED4", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>
            DISKON
          </div>
          <div style={{ height: "1px", background: "#F3F4F6", marginBottom: "20px" }}></div>

          <label style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#111827", marginBottom: "8px" }}>
            Persentase Diskon <span style={{ color: "#EF4444" }}>*</span>
          </label>
          <input 
            type="number"
            min="0"
            max="100"
            placeholder="Masukkan persentase diskon (contoh: 5 untuk diskon 5%)"
            value={tempDiscount}
            onChange={(e) => setTempDiscount(e.target.value)}
            style={{ 
              width: "100%", 
              padding: "12px 16px", 
              background: "#E2E8F0",
              border: "none", 
              borderRadius: "8px", 
              fontSize: "14px", 
              color: "#111827", 
              boxSizing: "border-box", 
              fontFamily: "'Inter', sans-serif",
              outline: "none"
            }}
          />
        </div>

        {/* Footer Pop-Up */}
        <div style={{ background: "#F8FAFC", padding: "16px 24px", display: "flex", justifyContent: "flex-end", gap: "16px" }}>
          <button 
            onClick={() => onOpenChange(false)} 
            style={{ background: "transparent", border: "none", fontWeight: 700, fontSize: "14px", color: "#374151", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}
          >
            Batal
          </button>
          <button 
            onClick={handleSaveDiscount} 
            style={{ background: "#630ED4", color: "#FFFFFF", border: "none", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}
          >
            Simpan Data
          </button>
        </div>

      </div>
    </div>
  );
}