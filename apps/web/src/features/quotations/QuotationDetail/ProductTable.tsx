import { useState } from "react"
import EntityLink from "@/components/shared/EntityLink"
import PageButtons from "@/components/shared/PageButtons"
import RowsPerPageMenu from "@/components/shared/RowsPerPageMenu"
import type { ProductRow } from "@/features/quotations/types"
import { formatRupiah as formatRp } from "@/lib/format"
import { clampPage, PAGE_SIZE_OPTIONS, pageCount } from "@/lib/pagination"
import { ui } from "@/lib/ui"
import RequestOffer from "../RequestOffer"
import { qe } from "../wizard-styles"
import { offerDiffers } from "./helpers"

type ProductTableProps = {
  showProfit?: boolean
  // The quotation shows the request; a PO or invoice bills the offer only
  showRequest?: boolean
  products: ProductRow[]
}

// Profit column classes.
//
// Legacy qd-th--profit / qd-td--profit, written standalone so no ui.* colour
// utility competes with the override.
const thProfit =
  "px-5 py-4 text-center align-middle text-overline font-bold uppercase tracking-[0.05em] whitespace-nowrap text-primary-700"
const tdProfit =
  "truncate p-5 text-center align-middle text-sm font-bold text-primary-700 bg-[rgba(99,14,212,0.05)]"

// Collapsible paginated product list.
export default function ProductTable({
  products,
  showProfit = true,
  showRequest = true,
}: ProductTableProps) {
  const [rawPage, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [expanded, setExpanded] = useState(true)

  if (products.length === 0) return null

  const total = products.length
  const totalPages = pageCount(total, pageSize)
  const page = clampPage(rawPage, totalPages)
  const start = (page - 1) * pageSize
  const slice = products.slice(start, start + pageSize)

  return (
    <div>
      <h2 className={`${qe.sectionTitle} mb-3`}>Detail Produk</h2>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border border-[rgba(204,195,216,0.2)] bg-white px-5 py-3.5 ${
          expanded ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-[#374151]">{products.length} produk</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RowsPerPageMenu
            value={pageSize}
            options={PAGE_SIZE_OPTIONS}
            onChange={(n) => {
              setPageSize(n)
              setPage(1)
            }}
            triggerClassName={`flex items-center gap-1.5 rounded-sm border border-dark-200 bg-white px-2.5 py-[5px] text-xs text-[#4A4455] ${ui.focusRing}`}
          />
          <PageButtons currentPage={page} totalPages={totalPages} onPage={setPage} dimDisabled />
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className={`flex items-center gap-[5px] rounded-sm border border-[rgba(204,195,216,0.5)] px-2.5 py-[5px] text-xs font-medium text-[#6B7280] ${ui.focusRing}`}
          >
            {expanded ? "Sembunyikan" : "Tampilkan"}
            <svg
              aria-hidden="true"
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              className={`motion-safe:transition-transform motion-safe:duration-200 ${expanded ? "" : "rotate-180"}`}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-full table-auto border-collapse max-lg:min-w-[760px] lg:table-fixed">
              <thead>
                <tr className={ui.theadRow}>
                  {showRequest ? (
                    <>
                      <th className={`${ui.thCenter} w-[220px]`}>Permintaan Klien</th>
                      <th className={`${ui.thCenter} w-[220px]`}>Penawaran</th>
                    </>
                  ) : (
                    <th className={`${ui.thCenter} w-[440px]`}>Produk</th>
                  )}
                  <th className={`${ui.thCenter} w-[80px]`}>Jumlah</th>
                  <th className={`${ui.thCenter} w-[80px]`}>Satuan</th>
                  <th className={`${ui.thCenter} w-[140px]`}>Harga Jual Satuan</th>
                  {showProfit && <th className={`${thProfit} w-[150px]`}>Profit (Rp)</th>}
                  <th className={`${ui.thCenter} w-[150px]`}>Total (Rp)</th>
                </tr>
              </thead>
              <tbody>
                {slice.map((p, i) => {
                  const reqKode = p.requestedKode || p.kode
                  const reqNama = p.requestedNama || p.nama
                  return (
                    <tr key={p.lineId ?? start + i} className={ui.tr}>
                      <RequestOffer
                        asCells
                        hideRequest={!showRequest}
                        request={{ kode: reqKode, nama: reqNama }}
                        offer={{
                          kode: p.kode,
                          nama: (
                            <EntityLink kind="product" id={p.itemId} tone="name">
                              {p.nama}
                            </EntityLink>
                          ),
                        }}
                        differs={showRequest && offerDiffers(p)}
                        noOffer={p.noOffer}
                      />
                      <td className={`${ui.tdCenter} truncate`}>{p.qty}</td>
                      <td className={`${ui.tdCenter} truncate`}>{p.satuan}</td>
                      <td className={`${ui.tdCenter} truncate`}>{formatRp(p.hargaSatuan)}</td>
                      {showProfit && (
                        <td className={tdProfit}>{formatRp(p.qty * p.profitSatuan)}</td>
                      )}
                      <td className={`${ui.tdCenter} truncate font-bold text-dark-900`}>
                        {formatRp(p.qty * p.hargaSatuan)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-dark-200 p-6">
            <span className="text-sm text-[#4A4455]">
              Menampilkan {total === 0 ? 0 : start + 1}-{Math.min(start + pageSize, total)} dari{" "}
              {total} Produk
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
