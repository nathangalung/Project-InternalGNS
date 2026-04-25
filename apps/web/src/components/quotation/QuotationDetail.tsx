import { useState } from "react";
import type { Page } from "../../main";
import Sidebar from "../shared/Sidebar";
import { getQuotation, updateQuotation, formatRp, computeGrandTotal } from "../../data/quotations";
import type { Status } from "../../data/quotations";

interface QuotationDetailProps {
  quotationId: string;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}

const statusConfig = {
  Disetujui: { bg: "var(--status-disetujui-bg)", color: "var(--status-disetujui-color)" },
  Dikirim:   { bg: "var(--status-dikirim-bg)",   color: "var(--status-dikirim-color)"   },
  Draf:      { bg: "var(--status-draf-bg)",       color: "var(--status-draf-color)"      },
  Revisi:    { bg: "var(--status-revisi-bg)",     color: "var(--status-revisi-color)"    },
  Ditolak:   { bg: "var(--status-ditolak-bg)",   color: "var(--status-ditolak-color)"   },
} as const;

const PAGE_SIZE_OPTIONS = [5, 10, 15];

function getPageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set(
    [1, 2, current - 1, current, current + 1, total - 1, total].filter(n => n >= 1 && n <= total)
  );
  const sorted = [...set].sort((a, b) => a - b);
  const pages: (number | null)[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) pages.push(null);
    pages.push(n);
    prev = n;
  }
  return pages;
}

function nowLabel(): string {
  return new Date().toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(/\./g, " ").replace(",", ",");
}

const fieldLabel = { fontSize: "11px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase" as const, marginBottom: "4px" };
const fieldValue = { fontSize: "14px", fontWeight: 500, color: "#111827" };

export default function QuotationDetail({ quotationId, onNavigate, onLogout }: QuotationDetailProps) {
  const q = getQuotation(quotationId);

  const [status, setStatus]             = useState<Status>(q?.status ?? "Draf");
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [history, setHistory]           = useState(q?.history ?? []);
  const [prodPage, setProdPage]         = useState(1);
  const [prodPageSize, setProdPageSize] = useState(5);
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false);
  const [prodExpanded, setProdExpanded] = useState(true);

  if (!q) {
    return (
      <div className="admin-shell">
        <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />
        <div className="admin-main"><div className="page-content"><p>Quotation tidak ditemukan.</p></div></div>
      </div>
    );
  }

  const badge = statusConfig[status];

  // Products pagination
  const totalProds     = q.products.length;
  const totalProdPages = Math.ceil(totalProds / prodPageSize) || 1;
  const prodStart      = (prodPage - 1) * prodPageSize;
  const prodSlice      = q.products.slice(prodStart, prodStart + prodPageSize);

  // Summary numbers
  const totalProduk   = q.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0);
  const totalProfit   = q.products.reduce((s, p) => s + p.qty * p.profitSatuan, 0);
  const totalShip     = q.shipping.hargaSatuan;
  const hasProducts   = q.products.length > 0;
  const discountPct   = q.discountPct ?? 0;
  const nominalDiskon = totalProduk * discountPct / 100;
  const subTotal      = totalProduk - nominalDiskon;
  const dppBase       = hasProducts ? subTotal : totalShip;
  const dppNilaiLain  = Math.round(dppBase * 11 / 12);
  const ppn12         = dppBase - dppNilaiLain;
  const grandTotal    = computeGrandTotal(q);

  // Client initials from name words
  const clientInitials = q.client.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const shippingAlamat = q.shipping.alamat;
  const ci = q.clientInfo;

  function handleStatusChange(s: Status) {
    setStatus(s);
    setIsStatusOpen(false);
  }

  function handleSave() {
    if (!q) return;
    const newHistory = status !== q.status
      ? [...history, { date: nowLabel(), action: `Status diubah menjadi ${status}` }]
      : history;
    updateQuotation(quotationId, { status, history: newHistory });
    setHistory(newHistory);
    onNavigate("quotation");
  }

  return (
    <div className="admin-shell">
      <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">

          {/* Breadcrumb */}
          <nav className="qd-breadcrumb">
            <button className="qd-breadcrumb-link" onClick={() => onNavigate("quotation")}>
              Daftar Quotation
            </button>
            <span className="qd-breadcrumb-sep">&rsaquo;</span>
            <span className="qd-breadcrumb-current">Detail {quotationId}</span>
          </nav>

          {/* Header */}
          <div className="qd-header">
            <div className="qd-header-left">
              <div>
                <h1 className="qd-title">Quotation {quotationId}</h1>
                <div className="qd-meta-row">
                  <span className="qd-meta-text">Dibuat pada: {q.createdAt}</span>
                  <span className="qd-meta-sep">|</span>
                  <span className="qd-meta-text">Versi {q.version}</span>
                  <span className="qd-meta-sep">|</span>
                  <span className="status-badge" style={{ background: badge.bg, color: badge.color }}>{status}</span>
                </div>
              </div>
            </div>
            <div className="qd-header-actions">
              <button className="btn-admin-outline" onClick={() => onNavigate("quotation-edit")} style={{ minWidth: "130px", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Ubah
              </button>
              <button className="btn-admin-primary" style={{ minWidth: "130px", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Unduh PDF
              </button>
            </div>
          </div>

          {/* Status Bar */}
          <div className="qd-status-bar">
            <div>
              <div className="qd-status-bar-title">Status Quotation</div>
              <div className="qd-status-bar-desc">Ubah status quotation sesuai dengan kondisi aktual.</div>
            </div>
            <div className="qd-status-bar-actions">
              <div style={{ position: "relative" }}>
                <button
                  className="qd-status-trigger"
                  style={{ background: badge.bg, color: badge.color }}
                  onClick={() => setIsStatusOpen(o => !o)}
                >
                  {status}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {isStatusOpen && (
                  <div className="qd-status-dropdown">
                    {(Object.keys(statusConfig) as Status[]).map(s => {
                      const isActive = s === status;
                      return (
                        <button key={s} className="qd-status-option" onClick={() => handleStatusChange(s)}>
                          <span className={isActive ? "qd-status-option--active" : "qd-status-option--label"}>{s}</span>
                          {isActive && (
                            <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                              <path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button className="btn-admin-primary" onClick={handleSave}>Simpan Data</button>
            </div>
          </div>

          {/* Ringkasan Klien */}
          <div>
            <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>Ringkasan Klien</h2>
            <div style={{ background: "#FFFFFF", border: "1px solid rgba(204,195,216,0.2)", borderRadius: "12px", overflow: "hidden" }}>

              {/* Avatar + name */}
              <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "20px 24px", borderBottom: "1px solid rgba(204,195,216,0.15)", background: "linear-gradient(135deg, rgba(99,14,212,0.04) 0%, rgba(99,14,212,0.01) 100%)" }}>
                <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(99,14,212,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: "16px", fontWeight: 800, color: "#630ED4", letterSpacing: "-0.5px" }}>{clientInitials}</span>
                </div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}>{q.client}</div>
                  <span style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>Indonesia</span>
                </div>
              </div>

              {/* Contact & legal */}
              <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(204,195,216,0.15)" }}>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#9CA3AF", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "16px" }}>Kontak &amp; Legalitas</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", rowGap: "20px", columnGap: "24px" }}>
                  <div><div style={fieldLabel}>Narahubung</div><div style={{ ...fieldValue, fontWeight: 600 }}>{ci?.narahubung || "-"}</div></div>
                  <div><div style={fieldLabel}>Nomor HP</div><div style={fieldValue}>{ci?.phone || "-"}</div></div>
                  <div><div style={fieldLabel}>Email Kontak</div><div style={fieldValue}>{ci?.email || "-"}</div></div>
                  <div><div style={fieldLabel}>Nomor TKU</div><div style={{ ...fieldValue, color: ci?.nomorTKU ? "#111827" : "#9CA3AF", fontStyle: ci?.nomorTKU ? "normal" : "italic" }}>{ci?.nomorTKU || "Belum diisi"}</div></div>
                  <div><div style={fieldLabel}>NPWP</div><div style={{ ...fieldValue, color: ci?.npwp ? "#111827" : "#9CA3AF", fontStyle: ci?.npwp ? "normal" : "italic" }}>{ci?.npwp || "Belum diisi"}</div></div>
                  <div><div style={fieldLabel}>Reference Number</div><div style={{ ...fieldValue, color: ci?.referenceNumber ? "#111827" : "#9CA3AF", fontStyle: ci?.referenceNumber ? "normal" : "italic" }}>{ci?.referenceNumber || "Belum diisi"}</div></div>
                </div>
              </div>

              {/* Addresses */}
              <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                <div>
                  <div style={fieldLabel}>Lokasi Perusahaan</div>
                  <div style={{ fontSize: "13px", fontWeight: 500, lineHeight: "1.6", marginTop: "4px", color: ci?.lokasi ? "#374151" : "#9CA3AF", fontStyle: ci?.lokasi ? "normal" : "italic" }}>{ci?.lokasi || "Belum diisi"}</div>
                </div>
                <div>
                  <div style={fieldLabel}>Alamat Pengiriman Barang</div>
                  <div style={{ fontSize: "13px", fontWeight: 500, lineHeight: "1.6", marginTop: "4px", color: shippingAlamat ? "#374151" : "#9CA3AF", fontStyle: shippingAlamat ? "normal" : "italic" }}>
                    {shippingAlamat || "Belum diisi"}
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Detail Pengiriman */}
          {totalShip > 0 && (
            <div>
              <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>Detail Pengiriman</h2>
              <div className="tbl-container">
                <table className="tbl">
                  <thead>
                    <tr className="tbl-header-row">
                      <th className="tbl-th tbl-th--center" style={{ width: 200 }}>Nama</th>
                      <th className="tbl-th tbl-th--center" style={{ width: 200 }}>Waktu Pengiriman (Hari Kerja)</th>
                      <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Harga Satuan</th>
                      <th className="tbl-th tbl-th--center" style={{ width: 160 }}>Total (Rp)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="tbl-row">
                      <td className="tbl-td tbl-td--center tbl-td--client">{q.shipping.nama}</td>
                      <td className="tbl-td tbl-td--center">{q.shipping.hari ?? "-"}</td>
                      <td className="tbl-td tbl-td--center">{formatRp(q.shipping.hargaSatuan)}</td>
                      <td className="tbl-td tbl-td--center tbl-td--total">{formatRp(q.shipping.hargaSatuan)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="pagination" style={{ justifyContent: "space-between" }}>
                  <span className="pagination-info">Menampilkan 1 dari 1 Pengiriman</span>
                  <div className="page-buttons">
                    <button className="page-btn-nav" disabled>
                      <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M4 1L1 4L4 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <button className="page-btn page-btn--active">1</button>
                    <button className="page-btn-nav" disabled>
                      <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M1 1L4 4L1 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Detail Produk — collapsible */}
          {q.products.length > 0 && (
            <div>
              <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>Detail Produk</h2>
              {/* Collapsible header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", background: "#FFFFFF", border: "1px solid rgba(204,195,216,0.2)", borderRadius: prodExpanded ? "12px 12px 0 0" : "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>{q.products.length} produk</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  {/* Row size dropdown */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setIsRowDropdownOpen(o => !o)}
                      style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 10px", borderRadius: "6px", border: "1px solid #E2E8F0", background: "#fff", cursor: "pointer", fontSize: "12px", color: "#4A4455", fontFamily: "'Inter', sans-serif" }}
                    >
                      {prodPageSize} Baris
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="#4A4455" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    {isRowDropdownOpen && (
                      <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, background: "#FFFFFF", border: "1px solid rgba(204,195,216,0.2)", boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.05)", borderRadius: "8px", display: "flex", flexDirection: "column", padding: "8px 0", width: "162px", zIndex: 50 }}>
                        {PAGE_SIZE_OPTIONS.map(val => {
                          const isActive = prodPageSize === val;
                          return (
                            <button key={val} onClick={() => { setProdPageSize(val); setProdPage(1); setIsRowDropdownOpen(false); }} style={{ display: "flex", justifyContent: isActive ? "space-between" : "flex-start", alignItems: "center", padding: "4px 20px", width: "100%", height: "32px", background: "transparent", border: "none", cursor: "pointer" }}>
                              <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: isActive ? 600 : 400, fontSize: "12px", color: isActive ? "#630ED4" : "#4A4455" }}>{val} Baris</span>
                              {isActive && (
                                <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                                  <path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* Pagination buttons */}
                  <div className="page-buttons">
                    <button className="page-btn-nav" disabled={prodPage === 1} onClick={() => setProdPage(p => Math.max(1, p - 1))}>
                      <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M4 1L1 4L4 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    {getPageNumbers(prodPage, totalProdPages).map((n, i) =>
                      n === null
                        ? <span key={`e${i}`} style={{ padding: "0 2px", color: "#9CA3AF", fontSize: "13px", alignSelf: "center", userSelect: "none" }}>…</span>
                        : <button key={n} onClick={() => setProdPage(n)} className={`page-btn${n === prodPage ? " page-btn--active" : ""}`}>{n}</button>
                    )}
                    <button className="page-btn-nav" disabled={prodPage === totalProdPages} onClick={() => setProdPage(p => Math.min(totalProdPages, p + 1))}>
                      <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M1 1L4 4L1 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </div>
                  {/* Toggle */}
                  <button
                    onClick={() => setProdExpanded(e => !e)}
                    style={{ display: "flex", alignItems: "center", gap: "5px", background: "none", border: "1px solid rgba(204,195,216,0.5)", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", fontSize: "12px", color: "#6B7280", fontFamily: "'Inter', sans-serif", fontWeight: 500 }}
                  >
                    {prodExpanded ? "Sembunyikan" : "Tampilkan"}
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transform: prodExpanded ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s ease" }}>
                      <path d="M1 5L5 1L9 5" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
              {/* Product table */}
              {prodExpanded && (
                <div style={{ border: "1px solid rgba(204,195,216,0.2)", borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
                  <table className="tbl">
                    <thead>
                      <tr className="tbl-header-row">
                        <th className="tbl-th tbl-th--center" style={{ width: 110 }}>Kode IMPA</th>
                        <th className="tbl-th tbl-th--center" style={{ width: 220 }}>Nama Produk</th>
                        <th className="tbl-th tbl-th--center" style={{ width: 80  }}>Jumlah</th>
                        <th className="tbl-th tbl-th--center" style={{ width: 80  }}>Satuan</th>
                        <th className="tbl-th tbl-th--center" style={{ width: 140 }}>Harga Satuan</th>
                        <th className="tbl-th tbl-th--center qd-th--profit" style={{ width: 150 }}>Profit (Rp)</th>
                        <th className="tbl-th tbl-th--center" style={{ width: 150 }}>Total (Rp)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodSlice.map((p, i) => (
                        <tr key={i} className="tbl-row">
                          <td className="tbl-td tbl-td--center tbl-td--id">{p.kode}</td>
                          <td className="tbl-td tbl-td--center tbl-td--client">{p.nama}</td>
                          <td className="tbl-td tbl-td--center">{p.qty}</td>
                          <td className="tbl-td tbl-td--center">{p.satuan}</td>
                          <td className="tbl-td tbl-td--center">{formatRp(p.hargaSatuan)}</td>
                          <td className="tbl-td tbl-td--center qd-td--profit">{formatRp(p.qty * p.profitSatuan)}</td>
                          <td className="tbl-td tbl-td--center tbl-td--total">{formatRp(p.qty * p.hargaSatuan)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="pagination" style={{ justifyContent: "space-between" }}>
                    <span className="pagination-info">
                      Menampilkan {totalProds === 0 ? 0 : prodStart + 1}–{Math.min(prodStart + prodPageSize, totalProds)} dari {totalProds} Produk
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Rincian Biaya */}
          <div>
            <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>Rincian Biaya</h2>
            <div style={{ background: "#F8FAFC", borderRadius: "12px", padding: "24px", border: "1px solid rgba(204,195,216,0.1)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
                {hasProducts && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}>
                    <span>Total Produk</span>
                    <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(totalProduk)}</span>
                  </div>
                )}
                {hasProducts && discountPct > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}>
                    <span>Diskon ({discountPct}%)</span>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <span style={{ textDecoration: "line-through", color: "#9CA3AF" }}>{formatRp(totalProduk)}</span>
                      <span style={{ fontWeight: 600, color: "#10B981" }}>- {formatRp(nominalDiskon)}</span>
                    </div>
                  </div>
                )}
                {hasProducts && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}>
                    <span>Sub Total</span>
                    <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(subTotal)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}>
                  <span>DPP Nilai Lain</span>
                  <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(dppNilaiLain)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}>
                  <span>PPN 12%</span>
                  <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(ppn12)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#4B5563" }}>
                  <span>Biaya Pengiriman</span>
                  <span style={{ fontWeight: 600, color: "#111827" }}>{formatRp(totalShip)}</span>
                </div>
              </div>

              <div style={{ height: "1px", background: "#E5E7EB", marginBottom: "16px" }} />

              {hasProducts && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", fontWeight: 700, color: "#6B7280", textTransform: "uppercase", marginBottom: "20px" }}>
                  <span>Total Estimasi Profit</span>
                  <span style={{ color: "#630ED4", fontSize: "12px" }}>{formatRp(totalProfit)}</span>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#6B7280", letterSpacing: "1px", textTransform: "uppercase" }}>Grand Total</span>
                <span style={{ fontSize: "28px", fontWeight: 800, color: "#630ED4", letterSpacing: "-0.5px" }}>{formatRp(grandTotal)}</span>
              </div>
            </div>

          </div>

          {/* Riwayat Penawaran */}
          <div>
            <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>Riwayat Penawaran</h2>
            <div className="qd-history-card">
            <div className="qd-timeline">
              {history.map((item, i) => {
                const isLast = i === history.length - 1;
                return (
                  <div key={i} className="qd-timeline-item">
                    <div className={`qd-timeline-dot${isLast ? " qd-timeline-dot--active" : ""}`} />
                    <span className={`qd-timeline-date${isLast ? " qd-timeline-date--active" : ""}`}>{item.date}</span>
                    <span className={`qd-timeline-action${isLast ? " qd-timeline-action--bold" : ""}`}>{item.action}</span>
                  </div>
                );
              })}
            </div>
          </div>
          </div>

        </div>
      </div>
    </div>
  );
}
