import { useState } from "react"
import type { ProductRow } from "@/features/quotations/types"
import { formatRupiah as formatRp } from "@/lib/format"
import { ui } from "@/lib/ui"
import { getPageNumbers, PAGE_SIZE_OPTIONS } from "./helpers"

interface ProductTableProps {
  showProfit?: boolean
  products: ProductRow[]
}

const pageBtn = "flex h-8 w-8 items-center justify-center rounded-sm text-sm transition"
const pageBtnIdle = "font-medium text-[#4A4455] hover:bg-dark-100"
const pageBtnActive = "bg-primary-700 font-bold text-white"
const pageBtnNav =
  "flex items-center justify-center rounded-sm border border-[#CCC3D8] p-2 transition hover:bg-dark-100"
const requestedNote = "mt-0.5 text-[11px] text-[#B45309]"

// Collapsible paginated product list.
export default function ProductTable({ products, showProfit = true }: ProductTableProps) {
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
      <h2 className="qe-section-title mb-3">Detail Produk</h2>
      <div
        className={`flex items-center justify-between border border-[rgba(204,195,216,0.2)] bg-white px-5 py-3.5 ${
          expanded ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-[#374151]">{products.length} produk</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsRowDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-sm border border-dark-200 bg-white px-2.5 py-[5px] text-xs text-[#4A4455]"
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
              <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 flex w-[162px] flex-col rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.05)]">
                {PAGE_SIZE_OPTIONS.map((val) => {
                  const isActive = pageSize === val
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        setPageSize(val)
                        setPage(1)
                        setIsRowDropdownOpen(false)
                      }}
                      className={`flex h-8 w-full items-center px-5 py-1 ${
                        isActive ? "justify-between" : "justify-start"
                      }`}
                    >
                      <span
                        className={`text-xs ${
                          isActive ? "font-semibold text-[#630ED4]" : "font-normal text-[#4A4455]"
                        }`}
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              className={pageBtnNav}
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
                  className="select-none self-center px-0.5 text-[13px] text-[#9CA3AF]"
                >
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={`${pageBtn} ${n === page ? pageBtnActive : pageBtnIdle}`}
                >
                  {n}
                </button>
              ),
            )}
            <button
              type="button"
              className={pageBtnNav}
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
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-[5px] rounded-sm border border-[rgba(204,195,216,0.5)] px-2.5 py-[5px] text-xs font-medium text-[#6B7280]"
          >
            {expanded ? "Sembunyikan" : "Tampilkan"}
            <svg
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              className={`transition-transform duration-200 ${expanded ? "" : "rotate-180"}`}
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
        <div className="overflow-hidden rounded-b-lg border border-t-0 border-[rgba(204,195,216,0.2)]">
          <table className="w-full min-w-full table-auto border-collapse lg:table-fixed">
            <thead>
              <tr className={ui.theadRow}>
                <th className={ui.thCenter} style={{ width: 110 }}>
                  Kode IMPA
                </th>
                <th className={ui.thCenter} style={{ width: 220 }}>
                  Nama Produk
                </th>
                <th className={ui.thCenter} style={{ width: 80 }}>
                  Jumlah
                </th>
                <th className={ui.thCenter} style={{ width: 80 }}>
                  Satuan
                </th>
                <th className={ui.thCenter} style={{ width: 140 }}>
                  Harga Jual Satuan
                </th>
                {showProfit && (
                  <th className={`${ui.thCenter} qd-th--profit`} style={{ width: 150 }}>
                    Profit (Rp)
                  </th>
                )}
                <th className={ui.thCenter} style={{ width: 150 }}>
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
                  <tr key={i} className={ui.tr}>
                    <td className={`${ui.tdCenter} truncate font-bold text-primary-700`}>
                      <div>{p.kode || "-"}</div>
                      {kodeDiffers && (
                        <div className={requestedNote} title="Kode IMPA yang diminta klien">
                          Diminta: {reqKode}
                        </div>
                      )}
                    </td>
                    <td className={`${ui.tdCenter} truncate font-medium text-dark-900`}>
                      <div>{p.nama}</div>
                      {namaDiffers && (
                        <div className={requestedNote} title="Nama produk yang diminta klien">
                          Diminta: {reqNama}
                        </div>
                      )}
                    </td>
                    <td className={`${ui.tdCenter} truncate`}>{p.qty}</td>
                    <td className={`${ui.tdCenter} truncate`}>{p.satuan}</td>
                    <td className={`${ui.tdCenter} truncate`}>{formatRp(p.hargaSatuan)}</td>
                    {showProfit && (
                      <td className={`${ui.tdCenter} truncate qd-td--profit`}>
                        {formatRp(p.qty * p.profitSatuan)}
                      </td>
                    )}
                    <td className={`${ui.tdCenter} truncate font-bold text-dark-900`}>
                      {formatRp(p.qty * p.hargaSatuan)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-dark-200 p-6">
            <span className="text-sm text-[#4A4455]">
              Menampilkan {total === 0 ? 0 : start + 1}–{Math.min(start + pageSize, total)} dari{" "}
              {total} Produk
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
