import React, { useState, useRef } from "react";
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
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setAttachments((prev) => [...prev, ...files]);
    e.target.value = "";
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

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

      {/* Lampiran Dokumen */}
      <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginBottom: "16px" }}>Lampiran Dokumen</h2>
      <div style={{ background: "#FFFFFF", border: "1px solid rgba(204, 195, 216, 0.2)", borderRadius: "12px", padding: "24px", marginBottom: "32px" }}>
        <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={handleFileChange} />
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{ border: "2px dashed rgba(99, 14, 212, 0.3)", borderRadius: "8px", padding: "32px", textAlign: "center", cursor: "pointer", background: "#FAFAFA", transition: "border-color 0.2s" }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#630ED4")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(99, 14, 212, 0.3)")}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#630ED4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 12px" }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#630ED4" }}>Klik untuk unggah file</p>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#6B7280" }}>PDF, Word, Excel, JPG, PNG — maks. 10 MB per file</p>
        </div>
        {attachments.length > 0 && (
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {attachments.map((file, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F8FAFC", borderRadius: "6px", padding: "10px 16px", border: "1px solid rgba(204,195,216,0.2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                    <polyline points="13 2 13 9 20 9"/>
                  </svg>
                  <span style={{ fontSize: "13px", color: "#111827", fontWeight: 500 }}>{file.name}</span>
                  <span style={{ fontSize: "11px", color: "#6B7280" }}>({(file.size / 1024).toFixed(0)} KB)</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "#EF4444", display: "flex", alignItems: "center" }}
                  title="Hapus"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
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
                    <div className="qep-field"><span className="qep-field-label">HARGA BELI SATUAN</span><div className="qep-field-input"><span className="qep-rp">Rp</span> {formatRp(p.hargaBeli)}</div></div>
                    <div className="qep-field"><span className="qep-field-label">HARGA JUAL SATUAN</span><div className="qep-field-input"><span className="qep-rp">Rp</span> {formatRp(p.hargaJual)}</div></div>
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