import { useState } from "react";
import type { Page } from "../../main";
import Sidebar from "../shared/Sidebar";
import ClientAdd from "../clients/ClientAdd";

interface QuotationEditProps {
  quotationId: string;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}

const steps = [
  { n: 1, label: "KLIEN" },
  { n: 2, label: "PRODUK" },
  { n: 3, label: "PENGIRIMAN" },
  { n: 4, label: "RINGKASAN" },
];

const clients = [
  { id: "C001", name: "PT Astra Modern",    country: "Indonesia", initials: "AM" },
  { id: "C002", name: "PT Telkom Prakarsa", country: "Indonesia", initials: "TP" },
  { id: "C003", name: "Bank Loka Mandiri",  country: "Indonesia", initials: "BL" },
  { id: "C004", name: "Global Network",     country: "Indonesia", initials: "GN" },
  { id: "C005", name: "Indo Food Group",    country: "Indonesia", initials: "IF" },
  { id: "C006", name: "Tech Solutions",     country: "Indonesia", initials: "TS" },
  { id: "C007", name: "Mandiri Finance",    country: "Indonesia", initials: "MF" },
  { id: "C008", name: "Surya Kencana",      country: "Indonesia", initials: "SK" },
  { id: "C009", name: "Delta Logistik",     country: "Indonesia", initials: "DL" },
];

interface ProductItem {
  id: number;
  nama: string;
  kodeImpa: string;
  vendor: string;
  jumlah: number;
  satuan: string;
  hargaBeli: number;
  hargaJual: number;
}

const initialProducts: ProductItem[] = [
  { id: 1, nama: "Marine Engine Filter Element",       kodeImpa: "330212", vendor: "PT Bahari Teknik",    jumlah: 24, satuan: "PCS", hargaBeli: 5006500,  hargaJual: 6587500  },
  { id: 2, nama: "Oli Hidrolik Kelas Industri (200L)", kodeImpa: "590741", vendor: "CV Pelumas Nusantara", jumlah: 10, satuan: "DRM", hargaBeli: 16688900, hargaJual: 18523300 },
  { id: 3, nama: "Shackle Tugas Berat (M42)",          kodeImpa: "626718", vendor: "PT Besi Kuat",         jumlah: 2,  satuan: "UNT", hargaBeli: 2970500,  hargaJual: 3587500  },
];

function formatRp(n: number): string {
  return n.toLocaleString("id-ID");
}


export default function QuotationEdit({ quotationId, onNavigate, onLogout }: QuotationEditProps) {
  const [step, setStep] = useState(1);
  const [selectedClient, setSelectedClient] = useState("C001");
  const [search, setSearch] = useState("");
  const [showClientAdd, setShowClientAdd] = useState(false);
  const [products, setProducts] = useState<ProductItem[]>(initialProducts);
  const [prodPageSize, setProdPageSize] = useState(5);
  const [prodPage, setProdPage] = useState(1);
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false);

  function updateProduct(id: number, field: keyof ProductItem, value: string | number) {
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));
  }

  function deleteProduct(id: number) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="admin-shell">
      <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">

          {/* Header */}
          <div className="qe-header-section">
            <div className="qe-header-left">
              <nav className="qd-breadcrumb">
                <button className="qd-breadcrumb-link" onClick={() => onNavigate("quotation")}>
                  Daftar Quotation
                </button>
                <span className="qd-breadcrumb-sep">&rsaquo;</span>
                <button className="qd-breadcrumb-link" onClick={() => onNavigate("quotation-detail")}>
                  {quotationId}
                </button>
                <span className="qd-breadcrumb-sep">&rsaquo;</span>
                <span className="qd-breadcrumb-current">Edit Quotation</span>
              </nav>
              <div className="qe-title-row">
                <button className="qd-back-btn" onClick={() => onNavigate("quotation-detail")} title="Kembali">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 5l-7 7 7 7"/>
                  </svg>
                </button>
                <h1 className="qe-title">Edit Quotation</h1>
              </div>
            </div>

            <div className="qe-header-actions">
              {step > 1 && (
                <button className="qe-back-step-btn" onClick={() => setStep(step - 1)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 5l-7 7 7 7"/>
                  </svg>
                  Kembali
                </button>
              )}
              {step < steps.length && (
                <button className="btn-admin-primary qe-next-btn" onClick={() => setStep(step + 1)}>
                  Lanjut
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Stepper */}
          <div className="qe-stepper">
            {steps.map((s, i) => (
              <>
                <div key={s.n} className="qe-step-slot">
                  <div className={`qe-step-pill${i === step - 1 ? " qe-step-pill--active" : ""}`}>
                    <span className={`qe-step-num${i === step - 1 ? " qe-step-num--active" : ""}`}>{s.n}</span>
                  </div>
                  <span className={`qe-step-label${i === step - 1 ? " qe-step-label--active" : ""}`}>{s.label}</span>
                </div>
                {i < steps.length - 1 && <div key={`line-${i}`} className="qe-step-connector" />}
              </>
            ))}
          </div>

          {/* Step 1: Pilih Klien */}
          {step === 1 && (
            <div className="qe-step-content">

              <div className="qe-section-header">
                <div>
                  <h2 className="qe-section-title">Pilih Klien Strategis</h2>
                  <p className="qe-section-desc">Tentukan mitra bisnis untuk penawaran harga ini.</p>
                </div>
                <button className="qe-add-client-btn" onClick={() => setShowClientAdd(true)}>
                  <svg width="16" height="14" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 15v-1a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v1"/>
                    <circle cx="8.5" cy="5" r="3"/>
                    <line x1="17" y1="5" x2="17" y2="11"/>
                    <line x1="14" y1="8" x2="20" y2="8"/>
                  </svg>
                  Tambah Klien Baru
                </button>
              </div>

              {/* Search */}
              <div className="qe-search-wrapper">
                <svg className="qe-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  className="qe-search-input"
                  type="text"
                  placeholder="Cari nama perusahaan atau ID klien..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {/* Client list */}
              <div className="qe-client-list">
                {filtered.map((client) => {
                  const isSelected = client.id === selectedClient;
                  return (
                    <button
                      key={client.id}
                      className={`qe-client-item${isSelected ? " qe-client-item--selected" : ""}`}
                      onClick={() => setSelectedClient(client.id)}
                    >
                      <div className="qe-client-avatar">
                        <span className="qe-client-initials">{client.initials}</span>
                      </div>
                      <div className="qe-client-info">
                        <span className="qe-client-name">{client.name}</span>
                        <span className="qe-client-country">
                          <svg width="9" height="12" viewBox="0 0 9 12" fill="none">
                            <path d="M4.5 0C2.015 0 0 2.015 0 4.5C0 7.875 4.5 12 4.5 12C4.5 12 9 7.875 9 4.5C9 2.015 6.985 0 4.5 0ZM4.5 6C3.672 6 3 5.328 3 4.5C3 3.672 3.672 3 4.5 3C5.328 3 6 3.672 6 4.5C6 5.328 5.328 6 4.5 6Z" fill="currentColor"/>
                          </svg>
                          {client.country}
                        </span>
                      </div>
                      <div className={`qe-radio${isSelected ? " qe-radio--selected" : ""}`}>
                        {isSelected && <div className="qe-radio-dot" />}
                      </div>
                    </button>
                  );
                })}
              </div>

            </div>
          )}

          {/* Step 2: Pilih Produk & Harga */}
          {step === 2 && (
            <div className="qe-step-content">

              {/* Section header */}
              <div className="qe-section-header">
                <div>
                  <h2 className="qe-section-title">Pilih Produk & Harga</h2>
                  <p className="qe-section-desc">Tentukan produk dan harga penawaran.</p>
                </div>
                <button className="qe-add-client-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  Tambah Produk ke Quotation
                </button>
              </div>

              {/* Search */}
              <div className="qe-search-wrapper">
                <svg className="qe-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  className="qe-search-input"
                  type="text"
                  placeholder="Cari nama produk atau kode IMPA..."
                />
              </div>

              {/* Two-column layout */}
              <div className="qep-layout">
                {/* Left: product cards */}
                <div className="qep-cards">
                  {/* Pagination controls */}
                  {(() => {
                    const totalProds = products.length;
                    const totalPages = Math.ceil(totalProds / prodPageSize) || 1;
                    const start = (prodPage - 1) * prodPageSize;
                    return (
                      <div className="pagination" style={{ paddingLeft: 0, paddingRight: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ position: "relative", display: "inline-block" }}>
                            <button
                              onClick={() => setIsRowDropdownOpen((o) => !o)}
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
                    );
                  })()}
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
                          <button className="qep-card-delete" onClick={() => deleteProduct(p.id)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                            </svg>
                          </button>
                        </div>
                        <div className="qep-card-body">
                          <div className="qep-col-left">
                            <div className="qep-field">
                              <span className="qep-field-label">VENDOR</span>
                              <input
                                className="qep-field-editable"
                                value={p.vendor}
                                onChange={(e) => updateProduct(p.id, "vendor", e.target.value)}
                              />
                            </div>
                            <div className="qep-field">
                              <span className="qep-field-label">JUMLAH PRODUK</span>
                              <input
                                className="qep-field-editable"
                                type="number"
                                min={1}
                                value={p.jumlah}
                                onChange={(e) => updateProduct(p.id, "jumlah", Number(e.target.value))}
                              />
                            </div>
                            <div className="qep-field">
                              <span className="qep-field-label">SATUAN</span>
                              <input
                                className="qep-field-editable"
                                value={p.satuan}
                                onChange={(e) => updateProduct(p.id, "satuan", e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="qep-col-right">
                            <div className="qep-field">
                              <span className="qep-field-label">HARGA BELI</span>
                              <div className="qep-field-input-rp">
                                <span className="qep-rp">Rp</span>
                                <input
                                  className="qep-field-editable qep-field-editable--rp"
                                  type="number"
                                  min={0}
                                  value={p.hargaBeli}
                                  onChange={(e) => updateProduct(p.id, "hargaBeli", Number(e.target.value))}
                                />
                              </div>
                            </div>
                            <div className="qep-field">
                              <span className="qep-field-label">HARGA JUAL</span>
                              <div className="qep-field-input-rp">
                                <span className="qep-rp">Rp</span>
                                <input
                                  className="qep-field-editable qep-field-editable--rp"
                                  type="number"
                                  min={0}
                                  value={p.hargaJual}
                                  onChange={(e) => updateProduct(p.id, "hargaJual", Number(e.target.value))}
                                />
                              </div>
                            </div>
                            <div className="qep-field">
                              <span className="qep-field-label">PROFIT</span>
                              <div className="qep-field-input">
                                <span className="qep-rp">Rp</span> {formatRp(profit)}
                                <span className="qep-profit-pct"> ({profitPct}%)</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Right: sidebar */}
                <div className="qep-sidebar">
                  <button className="qep-discount-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v8M8 12h8"/>
                    </svg>
                    Tambah Diskon Pembayaran
                  </button>
                  <div className="qep-summary-card">
                    <h3 className="qep-summary-title">Ringkasan Produk</h3>
                    <div className="qep-summary-row">
                      <span className="qep-summary-label">TOTAL HARGA JUAL</span>
                      <span className="qep-summary-value">Rp 405.000.000</span>
                    </div>
                    <div className="qep-summary-row">
                      <span className="qep-summary-label">SUB TOTAL</span>
                      <span className="qep-summary-value">Rp 384.750.000</span>
                    </div>
                    <div className="qep-summary-row">
                      <span className="qep-summary-label">DPP NILAI LAIN</span>
                      <span className="qep-summary-value">Rp 352.687.500</span>
                    </div>
                    <div className="qep-summary-row">
                      <span className="qep-summary-label">PPN 12%</span>
                      <span className="qep-summary-value">Rp 42.322.500</span>
                    </div>
                    <div className="qep-summary-row">
                      <span className="qep-summary-label">GRAND TOTAL</span>
                      <span className="qep-summary-value qep-summary-value--grand">Rp 42.322.500</span>
                    </div>
                  </div>

                  {/* Upload Excel */}
                  <div className="qep-upload-card">
                    <svg className="qep-upload-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="12" y1="18" x2="12" y2="12"/>
                      <line x1="9" y1="15" x2="15" y2="15"/>
                    </svg>
                    <span className="qep-upload-title">Unggah Dokumen (.xslx atau .csv)</span>
                    <label className="qep-upload-btn">
                      Pilih File
                      <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} />
                    </label>
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>

      <ClientAdd
        open={showClientAdd}
        onOpenChange={setShowClientAdd}
      />
    </div>
  );
}
