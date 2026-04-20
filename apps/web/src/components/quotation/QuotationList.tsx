import { useState, useMemo } from "react";
import type { Page } from "../../main";
import Sidebar from "../shared/Sidebar";
import FilterQuotation, { type DatePreset, type StatusFilter } from "./FilterQuotation";
import { quotations, formatRp } from "../../data/quotations";

interface QuotationListProps {
  onNavigate: (page: Page) => void;
  onLogout: () => void;
  onViewDetail?: (id: string) => void;
}

interface QuotationRow {
  id: string;
  version: number;
  client: string;
  date: string;
  total: string;
  status: "Disetujui" | "Dikirim" | "Draf" | "Revisi" | "Ditolak";
}

const tableData: QuotationRow[] = quotations.map((q) => ({
  id: q.id,
  version: q.version,
  client: q.client,
  date: q.createdAt.split(",")[0],
  total: formatRp(q.totalBayar),
  status: q.status,
}));

const statusConfig: Record<QuotationRow["status"], { bg: string; color: string }> = {
  Disetujui: { bg: "var(--status-disetujui-bg)", color: "var(--status-disetujui-color)" },
  Dikirim:   { bg: "var(--status-dikirim-bg)",   color: "var(--status-dikirim-color)"   },
  Draf:      { bg: "var(--status-draf-bg)",       color: "var(--status-draf-color)"      },
  Revisi:    { bg: "var(--status-revisi-bg)",     color: "var(--status-revisi-color)"    },
  Ditolak:   { bg: "var(--status-ditolak-bg)",   color: "var(--status-ditolak-color)"   },
};

function SortIcon({ direction }: { direction?: "asc" | "desc" | null }) {
  return (
    <svg width="6" height="10" viewBox="0 0 6 10" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 0L5.598 3.5H0.402L3 0Z" fill={direction === "asc" ? "#630ED4" : "#4A4455"} />
      <path d="M3 10L0.402 6.5H5.598L3 10Z" fill={direction === "desc" ? "#630ED4" : "#4A4455"} />
    </svg>
  );
}

export default function QuotationList({ onNavigate, onLogout, onViewDetail }: QuotationListProps) {
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [activeFilters, setActiveFilters] = useState<{
    preset: DatePreset;
    statuses: StatusFilter[];
    minHarga: string;
    maxHarga: string;
  } | null>(null);

  // State Pagination
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false);

  // State Sorting
  const [sortConfig, setSortConfig] = useState<{ key: keyof QuotationRow; direction: "asc" | "desc" } | null>(null);

  const requestSort = (key: keyof QuotationRow) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  // Logika potong data, sorting, & search
  const processedData = useMemo(() => {
    let sortableItems = [...tableData];

    // Filter Search
    if (search) {
      sortableItems = sortableItems.filter((item) =>
        item.client.toLowerCase().includes(search.toLowerCase()) ||
        item.id.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Filter Status
    if (activeFilters && activeFilters.statuses.length > 0) {
      sortableItems = sortableItems.filter((item) =>
        activeFilters.statuses.includes(item.status)
      );
    }

    // Filter Harga
    if (activeFilters) {
      const min = parseInt(activeFilters.minHarga.replace(/\./g, "")) || 0;
      const max = parseInt(activeFilters.maxHarga.replace(/\./g, "")) || Infinity;
      sortableItems = sortableItems.filter((item) => {
        const total = parseInt(item.total.replace(/[^0-9]/g, ""));
        return total >= min && total <= max;
      });
    }

    // Filter Tanggal
    if (activeFilters && activeFilters.preset !== "kustom") {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      if (activeFilters.preset === "7-hari")  start.setDate(start.getDate() - 7);
      if (activeFilters.preset === "30-hari") start.setDate(start.getDate() - 30);
      sortableItems = sortableItems.filter((item) => {
        const d = new Date(item.date);
        return d >= start && d <= today;
      });
    }

    // Sort Logic
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aValue: any = a[sortConfig.key];
        let bValue: any = b[sortConfig.key];

        if (sortConfig.key === "total") {
          aValue = parseInt(aValue.replace(/[^0-9]/g, ""));
          bValue = parseInt(bValue.replace(/[^0-9]/g, ""));
        } else if (sortConfig.key === "date") {
          aValue = new Date(aValue).getTime();
          bValue = new Date(bValue).getTime();
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return sortableItems;
  }, [search, sortConfig, activeFilters]);

  const totalItems = processedData.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentData = processedData.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="admin-shell">
      <Sidebar activePage="quotation" onNavigate={onNavigate} onLogout={onLogout} />

      <div className="admin-main">
        <div className="page-content">

          {/* Header */}
          <div className="page-header">
            <h1 className="page-title">Daftar Quotation</h1>
            <div className="page-actions">
              <button className="btn-admin-outline">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Ekspor Excel
              </button>
              <button className="btn-admin-outline">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Ekspor PDF
              </button>
              <button className="btn-admin-primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Quotation Baru
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="summary-cards">
            <div className="card-violet">
              <div className="card-label">Total Quotation</div>
              <div className="card-value">1.248</div>
            </div>
            <div className="card-gold">
              <div
                className="card-overlay"
                style={{ background: "linear-gradient(82.48deg, rgba(217,119,6,.5) 6.42%, rgba(245,158,11,.1) 93.58%)", opacity: 0.5 }}
              />
              <div className="card-label">Draf</div>
              <div className="card-value">84</div>
            </div>
            <div className="card-blue">
              <div
                className="card-overlay"
                style={{ background: "linear-gradient(82.48deg, rgba(63,86,255,.5) 6.42%, #DBEAFE 93.58%)", opacity: 0.5 }}
              />
              <div className="card-label">Dikirim</div>
              <div className="card-value">120</div>
            </div>
            <div className="card-green">
              <div className="card-glow" style={{ background: "rgba(52,211,153,.2)" }} />
              <div className="card-label">Disetujui</div>
              <div className="card-value">912</div>
            </div>
            <div className="card-red">
              <div className="card-glow" style={{ background: "rgba(239,94,94,.3)" }} />
              <div className="card-label">Ditolak</div>
              <div className="card-value">21</div>
            </div>
          </div>

          {/* Search & Filter */}
          <div className="search-row">
            <div className="search-wrapper">
              <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                className="search-input"
                placeholder="Cari penawaran, klien, atau nomor..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            
            <button className="btn-admin-filter" onClick={() => setShowFilter(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              Filter
            </button>
          </div>

          {/* Table */}
          <div className="tbl-container">
            <table className="tbl">
              <thead>
                <tr className="tbl-header-row">
                  <th 
                    className="tbl-th tbl-th--center" 
                    style={{ width: 160, cursor: "pointer" }}
                    onClick={() => requestSort("id")}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                      <span>Nomor Quotation</span>
                      <SortIcon direction={sortConfig?.key === "id" ? sortConfig.direction : null} />
                    </div>
                  </th>
                  <th 
                    className="tbl-th tbl-th--center" 
                    style={{ width: 70, cursor: "pointer" }}
                    onClick={() => requestSort("version")}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                      <span>Versi</span>
                      <SortIcon direction={sortConfig?.key === "version" ? sortConfig.direction : null} />
                    </div>
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 170 }}>Nama Klien</th>
                  <th 
                    className="tbl-th tbl-th--center" 
                    style={{ width: 120, cursor: "pointer" }}
                    onClick={() => requestSort("date")}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                      <span>Tanggal</span>
                      <SortIcon direction={sortConfig?.key === "date" ? sortConfig.direction : null} />
                    </div>
                  </th>
                  <th 
                    className="tbl-th tbl-th--center" 
                    style={{ width: 160, cursor: "pointer" }}
                    onClick={() => requestSort("total")}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                      <span>Total Penawaran</span>
                      <SortIcon direction={sortConfig?.key === "total" ? sortConfig.direction : null} />
                    </div>
                  </th>
                  <th className="tbl-th tbl-th--center" style={{ width: 120 }}>Status</th>
                  <th className="tbl-th tbl-th--center" style={{ width: 80 }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {currentData.map((row) => {
                  const badge = statusConfig[row.status];
                  return (
                    <tr key={row.id} className="tbl-row">
                      <td className="tbl-td tbl-td--id tbl-td--center">{row.id}</td>
                      <td className="tbl-td tbl-td--center">{row.version}</td>
                      <td className="tbl-td tbl-td--client tbl-td--center">{row.client}</td>
                      <td className="tbl-td tbl-td--center">{row.date}</td>
                      <td className="tbl-td tbl-td--total tbl-td--center">{row.total}</td>
                      <td className="tbl-td tbl-td--center">
                        <span
                          className="status-badge"
                          style={{ background: badge.bg, color: badge.color }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="tbl-td tbl-td--center">
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}>
                          <button className="action-btn" title="Lihat" onClick={() => onViewDetail?.(row.id)}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                              <circle cx="12" cy="12" r="3"/>
                            </svg>
                          </button>
                          <button className="action-btn" title="Download">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="pagination" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                
                {/* DROPDOWN JUMLAH BARIS CUSTOM */}
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
                    {itemsPerPage} Baris
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1L5 5L9 1" stroke="#4A4455" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {isRowDropdownOpen && (
                    <div style={{
                      position: "absolute",
                      bottom: "calc(100% + 8px)", // Ngebuka ke atas biar gak kepotong layar bawah
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
                      {[5, 10, 15].map((val) => {
                        const isActive = itemsPerPage === val;
                        return (
                          <button
                            key={val}
                            onClick={() => {
                              setItemsPerPage(val);
                              setCurrentPage(1);
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
                  Menampilkan {totalItems === 0 ? 0 : startIndex + 1}-{Math.min(startIndex + itemsPerPage, totalItems)} dari {totalItems} Quotation
                </span>
              </div>
              
              <div className="page-buttons">
                <button 
                  className="page-btn-nav"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M4 1L1 4L4 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button 
                    key={n} 
                    onClick={() => setCurrentPage(n)}
                    className={`page-btn${n === currentPage ? " page-btn--active" : ""}`}
                  >
                    {n}
                  </button>
                ))}
                
                <button 
                  className="page-btn-nav"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages === 0}
                >
                  <svg width="5" height="8" viewBox="0 0 5 8" fill="none"><path d="M1 1L4 4L1 7" stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {showFilter && (
        <FilterQuotation
          onClose={() => setShowFilter(false)}
          initialValues={activeFilters ?? undefined}
          onApply={(filters) => {
            setActiveFilters(filters);
            setCurrentPage(1);
          }}
        />
      )}
    </div>
  );
}