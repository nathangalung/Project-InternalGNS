import React from "react";

interface Step3ShippingProps {
  shippingAddress: string;
  setShippingAddress: (s: string) => void;
  shippingTime: string;
  setShippingTime: (s: string) => void;
  shippingCost: string;
  setShippingCost: (s: string) => void;
  isAlamatFilled: boolean;
  isWaktuFilled: boolean;
  disabledStyle: React.CSSProperties;
  formatRp: (n: number) => string;
}

export default function Step3Shipping({
  shippingAddress, setShippingAddress, shippingTime, setShippingTime,
  shippingCost, setShippingCost, isAlamatFilled, isWaktuFilled,
  disabledStyle, formatRp
}: Step3ShippingProps) {
  return (
    <div className="qe-step-content" style={{ maxWidth: "100%", margin: "0 auto", padding: "16px 0", fontFamily: "'Inter', sans-serif" }}>
      <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", marginBottom: "32px" }}>Detail Pengiriman</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginBottom: "40px" }}>
        <div>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#4B5563", letterSpacing: "0.5px", marginBottom: "8px", textTransform: "uppercase" }}>Alamat Lengkap <span style={{ color: "#EF4444" }}>*</span></label>
          <textarea
            placeholder="Masukkan alamat pengiriman secara detail..."
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            style={{ width: "100%", padding: "16px", background: "#E2E8F0", border: "none", borderRadius: "8px", fontSize: "14px", color: "#111827", fontFamily: "'Inter', sans-serif", outline: "none", resize: "vertical", minHeight: "100px", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ opacity: !isAlamatFilled ? 0.6 : 1, transition: "opacity 0.2s ease" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#4B5563", letterSpacing: "0.5px", marginBottom: "8px", textTransform: "uppercase" }}>Waktu Pengiriman <span style={{ color: "#EF4444" }}>*</span></label>
          <input
            type="text"
            placeholder="Masukkan jumlah hari kerja untuk waktu pengiriman setelah PO diterima..."
            value={shippingTime}
            onChange={(e) => setShippingTime(e.target.value)}
            disabled={!isAlamatFilled}
            style={{ width: "100%", padding: "16px", background: "#E2E8F0", border: "none", borderRadius: "8px", fontSize: "14px", color: "#111827", fontFamily: "'Inter', sans-serif", outline: "none", boxSizing: "border-box", ...(!isAlamatFilled ? disabledStyle : {}) }}
          />
        </div>

        <div style={{ opacity: !isWaktuFilled ? 0.6 : 1, transition: "opacity 0.2s ease" }}>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#4B5563", letterSpacing: "0.5px", marginBottom: "8px", textTransform: "uppercase" }}>Biaya Pengiriman <span style={{ color: "#EF4444" }}>*</span></label>
          <input
            type="number"
            placeholder="3570000 (Isi hanya dengan angka)"
            value={shippingCost}
            onChange={(e) => setShippingCost(e.target.value)}
            disabled={!isWaktuFilled}
            style={{ width: "100%", padding: "16px", background: "#E2E8F0", border: "none", borderRadius: "8px", fontSize: "14px", color: "#111827", fontFamily: "'Inter', sans-serif", outline: "none", boxSizing: "border-box", ...(!isWaktuFilled ? disabledStyle : {}) }}
          />
        </div>
      </div>

      <div className="qep-summary-card">
        <h3 className="qep-summary-title">Ringkasan Pengiriman</h3>
        <div className="qep-summary-row">
          <span className="qep-summary-label" style={{ textTransform: "none", fontWeight: 500 }}>Biaya Pengiriman</span>
          <span className="qep-summary-value" style={{ fontWeight: 700, color: "#111827" }}>Rp {formatRp(Number(shippingCost) || 0)}</span>
        </div>
        <div className="qep-summary-row">
          <span className="qep-summary-label">TOTAL PENGIRIMAN</span>
          <span className="qep-summary-value qep-summary-value--grand">Rp {formatRp(Number(shippingCost) || 0)}</span>
        </div>
      </div>
    </div>
  );
}