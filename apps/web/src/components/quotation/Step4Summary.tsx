import React from "react";
import type { Client } from "./Step1Client";
import type { ProductItem } from "./QuotationEdit";

interface Step4SummaryProps {
  jatuhTempo: string;
  setJatuhTempo: (s: string) => void;
  berlakuSampai: string;
  setBerlakuSampai: (s: string) => void;
  currentClient?: Client;
  shippingAddress: string;
  shippingTime: string;
  shippingCost: string;
  products: ProductItem[];
  discountPct: number;
  formatRp: (n: number) => string;
  summaryTotalProdukQty: number;
  summaryTotalHargaBeli: number;
  summaryTotalHargaJual: number;
  nominalDiskon: number;
  summarySubTotal: number;
  summaryDpp: number;
  summaryPpn: number;
  summaryShippingCost: number;
  summaryProfit: number;
  summaryGrandTotal: number;
}

export default function Step4Summary({
  jatuhTempo, setJatuhTempo, berlakuSampai, setBerlakuSampai,
  currentClient, shippingAddress, shippingTime, shippingCost,
  products, discountPct, formatRp,
  summaryTotalProdukQty, summaryTotalHargaBeli, summaryTotalHargaJual,
  nominalDiskon, summarySubTotal, summaryDpp, summaryPpn,
  summaryShippingCost, summaryProfit, summaryGrandTotal
}: Step4SummaryProps) {
  return (
    <div className="qe-step-content" style={{ maxWidth: "100%", margin: "0 auto", padding: "16px 0", fontFamily: "'Inter', sans-serif" }}>
      
      {/* Tenggat Waktu Penawaran */}
      <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "16px" }}>Tenggat Waktu Penawaran</h2>
      <div style={{ background: "#FFFFFF", border: "1px solid rgba(204, 195, 216, 0.2)", borderRadius: "12px", padding: "24px", marginBottom: "32px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
        <div>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#6B7280", letterSpacing: "0.5px", marginBottom: "8px", textTransform: "uppercase" }}>JATUH TEMPO PEMBAYARAN (HARI) <span style={{ color: "#EF4444" }}>*</span></label>
          <input type="number" min="1" placeholder="Masukkan hari sampai jatuh tempo" value={jatuhTempo} onChange={(e) => setJatuhTempo(e.target.value)} style={{ width: "100%", background: "#F8FAFC", border: "1px solid rgba(204, 195, 216, 0.2)", outline: "none", padding: "12px 16px", borderRadius: "8px", fontSize: "14px", color: "#111827", boxSizing: "border-box", fontFamily: "'Inter', sans-serif" }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#6B7280", letterSpacing: "0.5px", marginBottom: "8px", textTransform: "uppercase" }}>BERLAKU SAMPAI (HARI) <span style={{ color: "#EF4444" }}>*</span></label>
          <input type="number" min="1" placeholder="Masukkan jumlah hari" value={berlakuSampai} onChange={(e) => setBerlakuSampai(e.target.value)} style={{ width: "100%", background: "#F8FAFC", border: "1px solid rgba(204, 195, 216, 0.2)", outline: "none", padding: "12px 16px", borderRadius: "8px", fontSize: "14px", color: "#111827", boxSizing: "border-box", fontFamily: "'Inter', sans-serif" }} />
        </div>
      </div>

      {/* Ringkasan Klien */}
      <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "16px" }}>Ringkasan Klien</h2>
      <div style={{ background: "#FFFFFF", border: "1px solid rgba(204, 195, 216, 0.2)", borderRadius: "12px", padding: "24px", marginBottom: "32px", position: "relative" }}>
        <div style={{ fontSize: "10px", fontWeight: 700, color: "#6B7280", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "20px" }}>INFORMASI KLIEN</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", rowGap: "24px", columnGap: "16px" }}>
          <div><div style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>NAMA PERUSAHAAN</div><div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>{currentClient?.name || "-"}</div></div>
          <div><div style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>NAMA NARAHUBUNG</div><div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>{currentClient?.narahubung || "-"}</div></div>
          <div><div style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>REFERENCE NUMBER</div><div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>15823991992</div></div>
          <div><div style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>NOMOR TKU</div><div style={{ fontSize: "14px", fontWeight: 500, color: "#111827" }}>111111111111111111</div></div>
          <div><div style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>NOMOR HP</div><div style={{ fontSize: "14px", fontWeight: 500, color: "#111827" }}>+62 812-3456-7890</div></div>
          <div><div style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>EMAIL KONTAK</div><div style={{ fontSize: "14px", fontWeight: 500, color: "#111827" }}>ops@pacific-maritime.com</div></div>
          <div style={{ gridColumn: "span 2" }}><div style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>ALAMAT PENGIRIMAN</div><div style={{ fontSize: "14px", fontWeight: 500, color: "#111827", lineHeight: "1.5" }}>{shippingAddress || "-"}</div></div>
          <div><div style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>LOKASI PENGIRIMAN</div><div style={{ fontSize: "14px", fontWeight: 500, color: "#111827", lineHeight: "1.5" }}>Terminal 4, Pelabuhan Jakarta<br/><span style={{ color: "#6B7280", fontSize: "12px" }}>Kecamatan Jakarta Utara, JKT 14230</span></div></div>
        </div>
      </div>

      <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "16px" }}>Ringkasan Produk dan Pengiriman</h2>
      <div className="qep-layout" style={{ alignItems: "flex-start" }}>
        
        {/* Left Column: Products */}
        <div className="qep-cards" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {products.map((p, i) => {
            const profit = p.hargaJual - p.hargaBeli;
            const profitPct = p.hargaBeli > 0 ? ((profit / p.hargaBeli) * 100).toFixed(2) : "0.00";
            return (
              <div key={p.id} className="qep-card" style={{ marginBottom: 0 }}>
                <div className="qep-card-header">
                  <div className="qep-card-meta"><span className="qep-card-label">PRODUK {i + 1}</span><span className="qep-card-name">{p.nama}</span><span className="qep-card-code">KODE IMPA: {p.kodeImpa}</span></div>
                </div>
                <div className="qep-card-body">
                  <div className="qep-col-left">
                    <div className="qep-field"><span className="qep-field-label">VENDOR</span><div className="qep-field-input">{p.vendor}</div></div>
                    <div className="qep-field"><span className="qep-field-label">JUMLAH</span><div className="qep-field-input">{p.jumlah}</div></div>
                    <div className="qep-field"><span className="qep-field-label">SATUAN</span><div className="qep-field-input">{p.satuan}</div></div>
                  </div>
                  <div className="qep-col-right">
                    <div className="qep-field"><span className="qep-field-label">HARGA BELI</span><div className="qep-field-input"><span className="qep-rp">Rp</span> {formatRp(p.hargaBeli)}</div></div>
                    <div className="qep-field"><span className="qep-field-label">HARGA JUAL</span><div className="qep-field-input"><span className="qep-rp">Rp</span> {formatRp(p.hargaJual)}</div></div>
                    <div className="qep-field"><span className="qep-field-label">PROFIT</span><div className="qep-field-input"><span className="qep-rp">Rp</span> {formatRp(profit)} <span className="qep-profit-pct">({profitPct}%)</span></div></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Summaries */}
        <div className="qep-sidebar" style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: "340px" }}>
          
          <div style={{ background: "#FFFFFF", border: "1px solid rgba(204, 195, 216, 0.2)", borderRadius: "12px", padding: "24px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827", textTransform: "uppercase", marginBottom: "16px" }}>PENGIRIMAN</div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "10px", fontWeight: 600, color: "#6B7280", letterSpacing: "0.5px", marginBottom: "6px", textTransform: "uppercase" }}>WAKTU PENGIRIMAN (HARI KERJA)</label>
              <div style={{ background: "#F8FAFC", padding: "10px 12px", borderRadius: "6px", fontSize: "13px", color: "#111827", fontWeight: 500 }}>{shippingTime || "-"}</div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "10px", fontWeight: 600, color: "#6B7280", letterSpacing: "0.5px", marginBottom: "6px", textTransform: "uppercase" }}>BIAYA PENGIRIMAN</label>
              <div style={{ background: "#F8FAFC", padding: "10px 12px", borderRadius: "6px", fontSize: "13px", color: "#111827", fontWeight: 500 }}>Rp {formatRp(Number(shippingCost) || 0)}</div>
            </div>
          </div>

          <div style={{ background: "#F8FAFC", borderRadius: "12px", padding: "24px", border: "1px solid rgba(204, 195, 216, 0.1)" }}>
            <div style={{ fontSize: "10px", fontWeight: 700, color: "#6B7280", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "20px" }}>RINGKASAN PENAWARAN</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}><span>Total Produk</span><span style={{ fontWeight: 600, color: "#111827" }}>{summaryTotalProdukQty} Produk</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}><span>Total Harga Beli</span><span style={{ fontWeight: 600, color: "#111827" }}>Rp {formatRp(summaryTotalHargaBeli)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}><span>Total Harga Jual</span><span style={{ fontWeight: 600, color: "#111827" }}>Rp {formatRp(summaryTotalHargaJual)}</span></div>
              {discountPct > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}><span>Diskon ({discountPct}%)</span><span style={{ fontWeight: 600, color: "#10B981" }}>- Rp {formatRp(nominalDiskon)}</span></div>}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}><span>Sub Total</span><div style={{ display: "flex", gap: "8px", alignItems: "center" }}>{discountPct > 0 && <span style={{ textDecoration: "line-through", color: "#9CA3AF" }}>Rp {formatRp(summaryTotalHargaJual)}</span>}<span style={{ fontWeight: 600, color: "#111827" }}>Rp {formatRp(summarySubTotal)}</span></div></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}><span>DPP Nilai Lain</span><span style={{ fontWeight: 600, color: "#111827" }}>Rp {formatRp(summaryDpp)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}><span>PPN 12%</span><span style={{ fontWeight: 600, color: "#111827" }}>Rp {formatRp(summaryPpn)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}><span>Biaya Pengiriman</span><span style={{ fontWeight: 600, color: "#111827" }}>Rp {formatRp(summaryShippingCost)}</span></div>
            </div>

            <div style={{ height: "1px", background: "#E5E7EB", marginBottom: "16px" }}></div>
            
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", marginBottom: "24px" }}><span>TOTAL ESTIMASI PROFIT</span><span style={{ color: "#630ED4", fontSize: "12px" }}>Rp {formatRp(summaryProfit)}</span></div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#6B7280", letterSpacing: "1px", textTransform: "uppercase" }}>TOTAL ESTIMASI</span>
              <span style={{ fontSize: "28px", fontWeight: 800, color: "#630ED4", letterSpacing: "-0.5px" }}>Rp {formatRp(summaryGrandTotal)}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}