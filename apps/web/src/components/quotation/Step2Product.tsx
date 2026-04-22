import React from "react";
import type { ProductItem } from "./QuotationEdit";

interface Step2ProductProps {
  products: ProductItem[];
  deleteProduct: (id: number) => void;
  setEditingProduct: (p: ProductItem | null) => void;
  setShowProductAdd: (show: boolean) => void;
  prodPageSize: number;
  setProdPageSize: (size: number) => void;
  prodPage: number;
  setProdPage: (page: number | ((p: number) => number)) => void;
  isRowDropdownOpen: boolean;
  setIsRowDropdownOpen: (open: boolean) => void;
  setShowDiscountModal: (show: boolean) => void;
  discountPct: number;
  formatRp: (n: number) => string;
  summaryTotalHargaJual: number;
  nominalDiskon: number;
  summarySubTotal: number;
  summaryDpp: number;
  summaryPpn: number;
}

export default function Step2Product({
  products, deleteProduct, setEditingProduct, setShowProductAdd,
  prodPageSize, setProdPageSize, prodPage, setProdPage,
  isRowDropdownOpen, setIsRowDropdownOpen,
  setShowDiscountModal, discountPct, formatRp,
  summaryTotalHargaJual, nominalDiskon, summarySubTotal, summaryDpp, summaryPpn
}: Step2ProductProps) {
  const totalProds = products.length;
  const totalPages = Math.ceil(totalProds / prodPageSize) || 1;
  const start = (prodPage - 1) * prodPageSize;

  return (
    <div className="qe-step-content">
      <div className="qe-section-header">
        <div>
          <h2 className="qe-section-title">Pilih Produk & Harga</h2>
          <p className="qe-section-desc">Tentukan produk dan harga penawaran.</p>
        </div>
        <button className="qe-add-client-btn" onClick={() => { setEditingProduct(null); setShowProductAdd(true); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg> Tambah Produk
        </button>
      </div>

      <div className="qep-layout">
        <div className="qep-cards">
          {/* Pagination controls */}
          <div className="pagination" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ position: "relative", display: "inline-block" }}>
                <button
                  onClick={() => setIsRowDropdownOpen(!isRowDropdownOpen)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #E2E8F0", background: "#fff", cursor: "pointer", fontSize: "14px", color: "#4A4455", fontFamily: "'Inter', sans-serif" }}
                >
                  {prodPageSize} Baris
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="#4A4455" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                {isRowDropdownOpen && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, background: "#fff", border: "1px solid rgba(204,195,216,0.2)", boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.05)", borderRadius: "8px", display: "flex", flexDirection: "column", padding: "8px 0", width: "162px", zIndex: 50 }}>
                    {[5, 10, 15].map((val) => {
                      const isActive = prodPageSize === val;
                      return (
                        <button key={val} onClick={() => { setProdPageSize(val); setProdPage(1); setIsRowDropdownOpen(false); }} style={{ display: "flex", flexDirection: "row", justifyContent: isActive ? "space-between" : "flex-start", alignItems: "center", padding: "4px 20px", width: "100%", height: "32px", background: "transparent", border: "none", cursor: "pointer" }}>
                          <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: isActive ? 600 : 400, fontSize: "12px", color: isActive ? "#630ED4" : "#4A4455" }}>{val} Baris</span>
                          {isActive && <svg width="14" height="11" viewBox="0 0 14 11" fill="none"><path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <span className="pagination-info">Menampilkan {totalProds === 0 ? 0 : start + 1}–{Math.min(start + prodPageSize, totalProds)} dari {totalProds} Produk</span>
            </div>
            <div className="page-buttons">
              <button className="page-btn-nav" disabled={prodPage === 1} onClick={() => setProdPage((p) => Math.max(1, p - 1))}>
                <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M4 1L1 4L4 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setProdPage(n)} className={`page-btn${n === prodPage ? " page-btn--active" : ""}`}>{n}</button>
              ))}
              <button className="page-btn-nav" disabled={prodPage === totalPages} onClick={() => setProdPage((p) => Math.min(totalPages, p + 1))}>
                <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M1 1L4 4L1 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          </div>
          
          {/* Mapping Products */}
          {products.slice((prodPage - 1) * prodPageSize, prodPage * prodPageSize).map((p, i) => {
            const globalIndex = (prodPage - 1) * prodPageSize + i + 1;
            const profit = p.hargaJual - p.hargaBeli;
            const profitPct = p.hargaBeli > 0 ? ((profit / p.hargaBeli) * 100).toFixed(2) : "0.00";
            return (
              <div key={p.id} className="qep-card">
                <div className="qep-card-header">
                  <div className="qep-card-meta">
                    <span className="qep-card-label">PRODUK {globalIndex}</span>
                    <span className="qep-card-name">{p.nama}</span>
                    <span className="qep-card-code">KODE IMPA: {p.kodeImpa}</span>
                  </div>
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <button onClick={() => { setEditingProduct(p); setShowProductAdd(true); }} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#630ED4" }} title="Edit Produk">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button className="qep-card-delete" onClick={() => deleteProduct(p.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#EF4444" }} title="Hapus Produk">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                    </button>
                  </div>
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

        <div className="qep-sidebar">
          <button className="qep-discount-btn" onClick={() => setShowDiscountModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v8M8 12h8"/></svg>
            {discountPct > 0 ? `Diskon (${discountPct}%)` : "Tambah Diskon Pembayaran"}
          </button>
          <div className="qep-summary-card">
            <h3 className="qep-summary-title">Ringkasan Penawaran</h3>
            <div className="qep-summary-row"><span className="qep-summary-label">TOTAL HARGA JUAL</span><span className="qep-summary-value">Rp {formatRp(summaryTotalHargaJual)}</span></div>
            {discountPct > 0 && (
              <div className="qep-summary-row"><span className="qep-summary-label">DISKON ({discountPct}%)</span><span className="qep-summary-value" style={{ color: "#EF4444" }}>-Rp {formatRp(nominalDiskon)}</span></div>
            )}
            <div className="qep-summary-row"><span className="qep-summary-label">SUB TOTAL</span><span className="qep-summary-value">Rp {formatRp(summarySubTotal)}</span></div>
            <div className="qep-summary-row"><span className="qep-summary-label">DPP NILAI LAIN</span><span className="qep-summary-value">Rp {formatRp(summaryDpp)}</span></div>
            <div className="qep-summary-row"><span className="qep-summary-label">PPN 12%</span><span className="qep-summary-value">Rp {formatRp(summaryPpn)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}