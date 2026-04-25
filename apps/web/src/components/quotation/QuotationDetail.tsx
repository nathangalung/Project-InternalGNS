import { useState } from "react";
import type { Page } from "../../main";
import Sidebar from "../shared/Sidebar";
import { getQuotation, formatRp } from "../../data/quotations";
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

function nowLabel(): string {
  return new Date().toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(/\./g, " ").replace(",", ",");
}

export default function QuotationDetail({ quotationId, onNavigate, onLogout }: QuotationDetailProps) {
  const q = getQuotation(quotationId);

  const [status, setStatus]           = useState<Status>(q?.status ?? "Draf");
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [history, setHistory]         = useState(q?.history ?? []);
  const [prodPage, setProdPage]       = useState(1);
  const [prodPageSize, setProdPageSize] = useState(5);
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false);
  const [shipPage, setShipPage]       = useState(1);

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
  const totalProds   = q.products.length;
  const totalProdPages = Math.ceil(totalProds / prodPageSize);
  const prodStart    = (prodPage - 1) * prodPageSize;
  const prodSlice    = q.products.slice(prodStart, prodStart + prodPageSize);

  // Summary numbers
  const totalProduk  = q.products.reduce((s, p) => s + p.qty * p.hargaSatuan, 0);
  const totalProfit  = q.products.reduce((s, p) => s + p.qty * p.profitSatuan, 0);
  const totalShip    = q.shipping.hargaSatuan;
  const subTotal     = totalProduk + totalShip;
  const dppNilaiLain = Math.round(totalProduk * 11 / 12);
  const ppn12        = totalProduk - dppNilaiLain;

  function handleStatusChange(s: Status) {
    setStatus(s);
    setIsStatusOpen(false);
  }

  function handleSave() {
    if (!q) return; //

    if (status !== q.status) {
      setHistory((prev) => [
        ...prev,
        { date: nowLabel(), action: `Status diubah dari ${q.status} menjadi ${status}` },
      ]);
    }
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
                  onClick={() => setIsStatusOpen((o) => !o)}
                >
                  {status}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {isStatusOpen && (
                  <div className="qd-status-dropdown">
                    {(Object.keys(statusConfig) as Status[]).map((s) => {
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

          {/* Daftar Produk */}
          <div className="tbl-container">
            <div className="qd-section-header">
              <h3 className="qd-section-title">Daftar Produk</h3>
            </div>
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
            <div className="pagination" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ position: "relative", display: "inline-block" }}>
                  <button
                    onClick={() => setIsRowDropdownOpen(!isRowDropdownOpen)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #E2E8F0",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: "14px",
                      color: "#4A4455",
                      fontFamily: "'Inter', sans-serif"
                    }}
                  >
                    {prodPageSize} Baris
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1L5 5L9 1" stroke="#4A4455" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {isRowDropdownOpen && (
                    <div style={{
                      position: "absolute",
                      bottom: "calc(100% + 8px)",
                      left: 0,
                      background: "#FFFFFF",
                      border: "1px solid rgba(204, 195, 216, 0.2)",
                      boxShadow: "0px 0px 0px 1px rgba(0, 0, 0, 0.05)",
                      borderRadius: "8px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      padding: "8px 0px",
                      width: "162px",
                      zIndex: 50,
                      boxSizing: "border-box"
                    }}>
                      {PAGE_SIZE_OPTIONS.map((val) => {
                        const isActive = prodPageSize === val;
                        return (
                          <button
                            key={val}
                            onClick={() => {
                              setProdPageSize(val);
                              setProdPage(1);
                              setIsRowDropdownOpen(false);
                            }}
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              justifyContent: isActive ? "space-between" : "flex-start",
                              alignItems: "center",
                              padding: "4px 20px",
                              width: "100%",
                              height: "32px",
                              background: "transparent",
                              border: "none",
                              cursor: "pointer",
                              boxSizing: "border-box"
                            }}
                          >
                            <span style={{
                              fontFamily: "'Inter', sans-serif",
                              fontWeight: isActive ? 600 : 400,
                              fontSize: "12px",
                              lineHeight: "24px",
                              color: isActive ? "#630ED4" : "#4A4455",
                              display: "flex",
                              alignItems: "center"
                            }}>
                              {val} Baris
                            </span>

                            {isActive && (
                              <svg width="14" height="11" viewBox="0 0 14 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 5.5L4.5 9L13 1" stroke="#630ED4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <span className="pagination-info">
                  Menampilkan {totalProds === 0 ? 0 : prodStart + 1}–{Math.min(prodStart + prodPageSize, totalProds)} dari {totalProds} Produk
                </span>
              </div>
              <div className="page-buttons">
                <button className="page-btn-nav" disabled={prodPage === 1} onClick={() => setProdPage(p => Math.max(1, p - 1))}>
                  <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M4 1L1 4L4 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                {Array.from({ length: totalProdPages }, (_, i) => i + 1).map((n) => (
                  <button key={n} onClick={() => setProdPage(n)} className={`page-btn${n === prodPage ? " page-btn--active" : ""}`}>{n}</button>
                ))}
                <button className="page-btn-nav" disabled={prodPage === totalProdPages} onClick={() => setProdPage(p => Math.min(totalProdPages, p + 1))}>
                  <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M1 1L4 4L1 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            </div>
          </div>

          {/* Pengiriman */}
          <div className="tbl-container">
            <div className="qd-section-header">
              <h3 className="qd-section-title">Pengiriman</h3>
            </div>
            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th className="tbl-th tbl-th--center" style={{ width: 110 }}>Kode IMPA</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 220 }}>Nama</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 80  }}>Satuan</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 80  }}>Jumlah</th>
                  <th className="tbl-th tbl-th--center qd-th--deadline" style={{ width: 170 }}>Batas Waktu Sampai</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>Harga Satuan</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 150 }}>Total (Rp)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="tbl-row">
                  <td className="tbl-td tbl-td--center">-</td>
                  <td className="tbl-td tbl-td--center tbl-td--client">{q.shipping.nama}</td>
                  <td className="tbl-td tbl-td--center">-</td>
                  <td className="tbl-td tbl-td--center">1</td>
                  <td className="tbl-td tbl-td--center qd-td--deadline">{q.shipping.deadline}</td>
                  <td className="tbl-td tbl-td--center">{formatRp(q.shipping.hargaSatuan)}</td>
                  <td className="tbl-td tbl-td--center tbl-td--total">{formatRp(q.shipping.hargaSatuan)}</td>
                </tr>
              </tbody>
            </table>
            <div className="pagination">
              <div className="pagination-left">
                <span className="pagination-info">Menampilkan 1 dari 1 Pengiriman</span>
              </div>
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

          {/* Bottom: Riwayat + Ringkasan */}
          <div className="qd-bottom-grid">

            {/* History Timeline */}
            <div className="qd-history-card">
              <p className="qd-history-heading">Riwayat Penawaran</p>
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

            {/* Summary */}
            <div className="qd-summary-card">
              <div className="qd-summary-rows">
                <div className="qd-summary-row">
                  <span className="qd-summary-label">Total Produk</span>
                  <span className="qd-summary-value">{formatRp(totalProduk)}</span>
                </div>
                <div className="qd-summary-row">
                  <span className="qd-summary-label">Total Biaya Pengiriman</span>
                  <span className="qd-summary-value">{formatRp(totalShip)}</span>
                </div>
                <div className="qd-summary-row">
                  <span className="qd-summary-label">Sub Total</span>
                  <span className="qd-summary-value">{formatRp(subTotal)}</span>
                </div>
                <div className="qd-summary-row">
                  <span className="qd-summary-label">DPP Nilai Lain</span>
                  <span className="qd-summary-value">{formatRp(dppNilaiLain)}</span>
                </div>
                <div className="qd-summary-row">
                  <span className="qd-summary-label">PPN 12%</span>
                  <span className="qd-summary-value">{formatRp(ppn12)}</span>
                </div>
              </div>
              <div className="qd-summary-profit-row">
                <span className="qd-summary-profit-label">Total Estimasi Profit</span>
                <span className="qd-summary-profit-value">{formatRp(totalProfit)}</span>
              </div>
              <div className="qd-summary-total-section">
                <span className="qd-summary-total-label">Total Yang Harus Dibayar</span>
                <span className="qd-summary-total-value">{formatRp(q.totalBayar)}</span>
                <span className="qd-summary-total-note">Seluruh nilai dalam Rupiah (IDR) termasuk PPN</span>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
