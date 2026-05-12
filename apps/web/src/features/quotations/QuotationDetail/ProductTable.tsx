import { useState } from "react"
import type { ProductRow } from "@/features/quotations/types"
import { formatRupiah as formatRp } from "@/lib/format"
import { getPageNumbers, PAGE_SIZE_OPTIONS } from "./helpers"

interface ProductTableProps {
  products: ProductRow[]
}

// Collapsible paginated product list.
export default function ProductTable({ products }: ProductTableProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [isRowDropdownOpen, setIsRowDropdownOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)

  if (products.length === 0) return null

  const total = products.length
  const totalPages = Math.ceil(total / pageSize) || 1
  const start = (page - 1) * pageSize
  const slice = products.slice(start, start + pageSize)

  return (
    <div>
      <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>
        Detail Produk
      </h2>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 20px",
          background: "#FFFFFF",
          border: "1px solid rgba(204,195,216,0.2)",
          borderRadius: expanded ? "12px 12px 0 0" : "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
            {products.length} produk
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setIsRowDropdownOpen((o) => !o)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid #E2E8F0",
                background: "#fff",
                cursor: "pointer",
                fontSize: "12px",
                color: "#4A4455",
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {pageSize} Baris
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path
                  d="M1 1L5 5L9 1"
                  stroke="#4A4455"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {isRowDropdownOpen && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 0,
                  background: "#FFFFFF",
                  border: "1px solid rgba(204,195,216,0.2)",
                  boxShadow: "0px 0px 0px 1px rgba(0,0,0,0.05)",
                  borderRadius: "8px",
                  display: "flex",
                  flexDirection: "column",
                  padding: "8px 0",
                  width: "162px",
                  zIndex: 50,
                }}
              >
                {PAGE_SIZE_OPTIONS.map((val) => {
                  const isActive = pageSize === val
                  return (
                    <button
                      key={val}
                      onClick={() => {
                        setPageSize(val)
                        setPage(1)
                        setIsRowDropdownOpen(false)
                      }}
                      style={{
                        display: "flex",
                        justifyContent: isActive ? "space-between" : "flex-start",
                        alignItems: "center",
                        padding: "4px 20px",
                        width: "100%",
                        height: "32px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontWeight: isActive ? 600 : 400,
                          fontSize: "12px",
                          color: isActive ? "#630ED4" : "#4A4455",
                        }}
                      >
                        {val} Baris
                      </span>
                      {isActive && (
                        <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                          <path
                            d="M1 5.5L4.5 9L13 1"
                            stroke="#630ED4"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="page-buttons">
            <button
              className="page-btn-nav"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
                <path
                  d="M4 1L1 4L4 7"
                  stroke="#191C1E"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {getPageNumbers(page, totalPages).map((n, i) =>
              n === null ? (
                <span
                  key={`e${i}`}
                  style={{
                    padding: "0 2px",
                    color: "#9CA3AF",
                    fontSize: "13px",
                    alignSelf: "center",
                    userSelect: "none",
                  }}
                >
                  …
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`page-btn${n === page ? " page-btn--active" : ""}`}
                >
                  {n}
                </button>
              ),
            )}
            <button
              className="page-btn-nav"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
                <path
                  d="M1 1L4 4L1 7"
                  stroke="#191C1E"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              background: "none",
              border: "1px solid rgba(204,195,216,0.5)",
              borderRadius: "6px",
              padding: "5px 10px",
              cursor: "pointer",
              fontSize: "12px",
              color: "#6B7280",
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
            }}
          >
            {expanded ? "Sembunyikan" : "Tampilkan"}
            <svg
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              style={{
                transform: expanded ? "rotate(0deg)" : "rotate(180deg)",
                transition: "transform 0.2s ease",
              }}
            >
              <path
                d="M1 5L5 1L9 5"
                stroke="#6B7280"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      {expanded && (
        <div
          style={{
            border: "1px solid rgba(204,195,216,0.2)",
            borderTop: "none",
            borderRadius: "0 0 12px 12px",
            overflow: "hidden",
          }}
        >
          <table className="tbl">
            <thead>
              <tr className="tbl-header-row">
                <th className="tbl-th tbl-th--center" style={{ width: 110 }}>
                  Kode IMPA
                </th>
                <th className="tbl-th tbl-th--center" style={{ width: 220 }}>
                  Nama Produk
                </th>
                <th className="tbl-th tbl-th--center" style={{ width: 80 }}>
                  Jumlah
                </th>
                <th className="tbl-th tbl-th--center" style={{ width: 80 }}>
                  Satuan
                </th>
                <th className="tbl-th tbl-th--center" style={{ width: 140 }}>
                  Harga Satuan
                </th>
                <th className="tbl-th tbl-th--center qd-th--profit" style={{ width: 150 }}>
                  Profit (Rp)
                </th>
                <th className="tbl-th tbl-th--center" style={{ width: 150 }}>
                  Total (Rp)
                </th>
              </tr>
            </thead>
            <tbody>
              {slice.map((p, i) => {
                const reqKode = p.requestedKode ?? ""
                const reqNama = p.requestedNama ?? ""
                const kodeDiffers = reqKode.length > 0 && reqKode !== p.kode
                const namaDiffers = reqNama.length > 0 && reqNama !== p.nama
                return (
                  <tr key={i} className="tbl-row">
                    <td className="tbl-td tbl-td--center tbl-td--id">
                      <div>{p.kode || "-"}</div>
                      {kodeDiffers && (
                        <div
                          style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}
                          title="Kode IMPA yang diminta klien"
                        >
                          Diminta: {reqKode}
                        </div>
                      )}
                    </td>
                    <td className="tbl-td tbl-td--center tbl-td--client">
                      <div>{p.nama}</div>
                      {namaDiffers && (
                        <div
                          style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}
                          title="Nama produk yang diminta klien"
                        >
                          Diminta: {reqNama}
                        </div>
                      )}
                    </td>
                    <td className="tbl-td tbl-td--center">{p.qty}</td>
                    <td className="tbl-td tbl-td--center">{p.satuan}</td>
                    <td className="tbl-td tbl-td--center">{formatRp(p.hargaSatuan)}</td>
                    <td className="tbl-td tbl-td--center qd-td--profit">
                      {formatRp(p.qty * p.profitSatuan)}
                    </td>
                    <td className="tbl-td tbl-td--center tbl-td--total">
                      {formatRp(p.qty * p.hargaSatuan)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="pagination" style={{ justifyContent: "space-between" }}>
            <span className="pagination-info">
              Menampilkan {total === 0 ? 0 : start + 1}–{Math.min(start + pageSize, total)} dari{" "}
              {total} Produk
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
