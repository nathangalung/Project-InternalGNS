import { useId, useState } from "react"
import PageButtons from "@/components/shared/PageButtons"
import { optionalCls } from "@/features/clients/ClientAdd/helpers"
import { clampPage, pageCount } from "@/lib/pagination"
import { ui } from "@/lib/ui"
import { isValidAddress, optionalAddressError } from "@/lib/validation"
import { requestDiffers, requestedCode } from "./lines"
import RequestOffer from "./RequestOffer"
import type { Client } from "./Step1Client"
import type { ProductItem } from "./wizard"
import { qe, qep } from "./wizard-styles"

// Quotation reference and terms.
type SummaryTerms = {
  jatuhTempo: string
  setJatuhTempo: (s: string) => void
  berlakuSampai: string
  setBerlakuSampai: (s: string) => void
  // The client's own RFQ or PO number
  clientRefNo: string
  setClientRefNo: (s: string) => void
}

type Step4SummaryProps = {
  // Absent on a PO, which keeps its quotation's reference and terms
  terms?: SummaryTerms
  currentClient?: Client
  shippingAddress: string
  shippingTime: string
  shippingCost: string
  products: ProductItem[]
  discountPct: number
  formatRp: (n: number) => string
  summaryTotalProdukQty: number
  summaryTotalHargaBeli: number
  summaryTotalHargaJual: number
  nominalDiskon: number
  summarySubTotal: number
  summaryDpp: number
  summaryPpn: number
  summaryShippingCost: number
  summaryProfit: number
  summaryGrandTotal: number
  // Lines with qty not above zero
  invalidQtyCount?: number
  // Lines with an unknown unit
  unknownUnitCount?: number
  // Lines not ready to send
  incompleteCount?: number
  // Another user holds the header
  readOnly?: boolean
}

const PAGE_SIZE = 5

const card = "rounded-lg border border-[rgba(204,195,216,0.2)] bg-white p-6"
const grid2 = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))]"
const grid3 = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))]"
const fieldLabel = "mb-1 text-[11px] font-semibold uppercase text-[#6B7280]"
const fieldValue = "text-sm font-medium text-[#111827]"
const fieldValueSemibold = "text-sm font-semibold text-[#111827]"
const fieldValueBold = "text-sm font-bold text-[#111827]"
const emptyValue = "text-sm font-medium italic text-[#9CA3AF]"
const formLabel = "mb-2 block text-[11px] font-bold uppercase tracking-[0.5px] text-[#6B7280]"
const formInput = `box-border w-full rounded-md border border-[rgba(204,195,216,0.2)] bg-dark-50 px-4 py-3 text-sm text-[#111827] outline-none disabled:cursor-not-allowed disabled:opacity-60 ${ui.fieldFocus}`
const alertBox =
  "rounded-md border border-[rgba(239,68,68,0.18)] bg-[rgba(239,68,68,0.06)] px-3.5 py-2.5 text-xs font-medium text-[#DC2626]"
// Amber: saving still works
const noticeBox =
  "rounded-md border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3.5 py-2.5 text-xs font-medium text-[#92400E]"
const costRow = "flex justify-between text-xs text-[#4B5563]"
const costValue = "font-semibold text-[#111827]"

function termsFilled(t: SummaryTerms): boolean {
  return t.jatuhTempo.trim().length > 0 && t.berlakuSampai.trim().length > 0
}

// Client reference input.
//
// Printed as Your Ref No. on the quotation PDF.
function RefCard({ terms, id, readOnly }: { terms: SummaryTerms; id: string; readOnly: boolean }) {
  return (
    <>
      <h2 className={`${qe.sectionTitle} mb-3`}>Referensi Klien</h2>
      <div className={`${card} mb-6`}>
        <label htmlFor={`${id}-ref`} className={formLabel}>
          No. Referensi Klien <span className={optionalCls}>(Opsional)</span>
        </label>
        <input
          id={`${id}-ref`}
          type="text"
          maxLength={100}
          aria-describedby={`${id}-ref-hint`}
          placeholder="Nomor RFQ atau PO dari klien"
          value={terms.clientRefNo}
          onChange={(e) => terms.setClientRefNo(e.target.value)}
          disabled={readOnly}
          className={formInput}
        />
        <span id={`${id}-ref-hint`} className="mt-1 block text-xs text-dark-600">
          Dicetak sebagai Your Ref No. di PDF quotation.
        </span>
      </div>
    </>
  )
}

// Tenggat Waktu Penawaran inputs.
function TermsCard({
  terms,
  id,
  readOnly,
}: {
  terms: SummaryTerms
  id: string
  readOnly: boolean
}) {
  return (
    <>
      <h2 className={`${qe.sectionTitle} mb-3`}>Tenggat Waktu Penawaran</h2>
      <div className={`${card} ${grid2} gap-6`}>
        <div>
          <label htmlFor={`${id}-tempo`} className={formLabel}>
            JATUH TEMPO PEMBAYARAN (HARI) <span className="text-error">*</span>
          </label>
          <input
            id={`${id}-tempo`}
            type="number"
            min="1"
            placeholder="Masukkan hari sampai jatuh tempo"
            value={terms.jatuhTempo}
            onChange={(e) => terms.setJatuhTempo(e.target.value)}
            disabled={readOnly}
            className={formInput}
          />
        </div>
        <div>
          <label htmlFor={`${id}-berlaku`} className={formLabel}>
            BERLAKU SAMPAI (HARI) <span className="text-error">*</span>
          </label>
          <input
            id={`${id}-berlaku`}
            type="number"
            min="1"
            max="365"
            placeholder="Masukkan jumlah hari"
            value={terms.berlakuSampai}
            onChange={(e) => terms.setBerlakuSampai(e.target.value)}
            disabled={readOnly}
            className={formInput}
          />
        </div>
      </div>
    </>
  )
}

export default function Step4Summary({
  terms,
  currentClient,
  shippingAddress,
  shippingTime,
  shippingCost,
  products,
  discountPct,
  formatRp,
  summaryTotalProdukQty,
  summaryTotalHargaBeli,
  summaryTotalHargaJual,
  nominalDiskon,
  summarySubTotal,
  summaryDpp,
  summaryPpn,
  summaryShippingCost,
  summaryProfit,
  summaryGrandTotal,
  invalidQtyCount = 0,
  unknownUnitCount = 0,
  incompleteCount = 0,
  readOnly = false,
}: Step4SummaryProps) {
  const id = useId()
  const [prodPage, setProdPage] = useState(1)
  const [prodExpanded, setProdExpanded] = useState(true)

  const totalPages = pageCount(products.length, PAGE_SIZE)
  // Removed lines can shrink pages.
  const page = clampPage(prodPage, totalPages)
  const pageSlice = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const hasContent = products.length > 0 || isValidAddress(shippingAddress)
  const addressError = optionalAddressError(shippingAddress)
  const hasNotices = invalidQtyCount > 0 || incompleteCount > 0 || unknownUnitCount > 0

  return (
    <div className={qe.stepContent}>
      {(terms || hasNotices) && (
        <div>
          {terms && <RefCard terms={terms} id={id} readOnly={readOnly} />}
          {terms && <TermsCard terms={terms} id={id} readOnly={readOnly} />}
          {invalidQtyCount > 0 && (
            <div role="alert" className={`${alertBox} mt-2.5`}>
              {invalidQtyCount} produk memiliki jumlah 0 atau kurang. Perbaiki di langkah Produk
              sebelum menyimpan.
            </div>
          )}
          {incompleteCount > 0 && (
            <div role="status" className={`${noticeBox} mt-2.5`}>
              {incompleteCount} produk belum lengkap (vendor atau harga). Quotation tetap tersimpan
              sebagai Draf. Lengkapi sebelum dikirim.
            </div>
          )}
          {unknownUnitCount > 0 && (
            <div role="alert" className={`${alertBox} mt-2.5`}>
              {unknownUnitCount} produk memiliki satuan yang tidak dikenal. Pilih satuannya di
              langkah Produk sebelum menyimpan.
            </div>
          )}
          {terms && !termsFilled(terms) && (
            <div className={`${alertBox} mt-2.5`}>
              Isi jatuh tempo pembayaran dan masa berlaku sebelum menyimpan.
            </div>
          )}
        </div>
      )}

      {/* Ringkasan Klien */}
      <div>
        <h2 className={`${qe.sectionTitle} mb-3`}>Ringkasan Klien</h2>
        <div className="overflow-hidden rounded-lg border border-[rgba(204,195,216,0.2)] bg-white">
          {/* Card header with avatar */}
          <div className="flex items-center gap-4 border-b border-[rgba(204,195,216,0.15)] bg-[linear-gradient(135deg,rgba(99,14,212,0.04)_0%,rgba(99,14,212,0.01)_100%)] px-6 py-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[rgba(99,14,212,0.12)]">
              <span className="text-base font-extrabold tracking-[-0.5px] text-primary-700">
                {currentClient?.initials || "-"}
              </span>
            </div>
            <div>
              <div className="mb-1 text-base font-bold text-[#111827]">
                {currentClient?.name || "-"}
              </div>
              <span className="text-xs font-medium text-[#6B7280]">
                {currentClient?.country || "-"}
              </span>
            </div>
          </div>

          {/* Contact & legal info */}
          <div className="border-b border-[rgba(204,195,216,0.15)] px-6 py-5">
            <div className="mb-4 text-[10px] font-bold uppercase tracking-[1px] text-[#9CA3AF]">
              Kontak &amp; Legalitas
            </div>
            <div className={`${grid3} gap-x-6 gap-y-5`}>
              <div>
                <div className={fieldLabel}>Narahubung</div>
                <div className={fieldValueSemibold}>{currentClient?.narahubung || "-"}</div>
              </div>
              <div>
                <div className={fieldLabel}>Nomor HP</div>
                <div className={fieldValue}>{currentClient?.phone || "-"}</div>
              </div>
              <div>
                <div className={fieldLabel}>Email Kontak</div>
                <div className={fieldValue}>{currentClient?.email || "-"}</div>
              </div>
              <div>
                <div className={fieldLabel}>Nomor TKU</div>
                <div className={currentClient?.nomorTKU ? fieldValue : emptyValue}>
                  {currentClient?.nomorTKU || "Belum diisi"}
                </div>
              </div>
              <div>
                <div className={fieldLabel}>NPWP</div>
                <div className={currentClient?.npwp ? fieldValue : emptyValue}>
                  {currentClient?.npwp || "Belum diisi"}
                </div>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div className={`${grid2} gap-6 px-6 py-5`}>
            <div>
              <div className={fieldLabel}>Lokasi Perusahaan</div>
              <div
                className={`mt-1 text-[13px] font-medium leading-[1.6] ${
                  currentClient?.lokasi ? "text-[#374151]" : "italic text-[#9CA3AF]"
                }`}
              >
                {currentClient?.lokasi || "Belum diisi"}
              </div>
            </div>
            <div>
              <div className={fieldLabel}>Alamat Pengiriman Barang</div>
              <div
                className={`mt-1 text-[13px] font-medium leading-[1.6] ${
                  shippingAddress ? "text-[#374151]" : "italic text-[#9CA3AF]"
                }`}
              >
                {shippingAddress || "Belum diisi"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ringkasan Penawaran */}
      <div>
        <h2 className={`${qe.sectionTitle} mb-3`}>Ringkasan Penawaran</h2>

        {!hasContent && (
          <div className={`${alertBox} mb-5`}>
            Isi minimal satu produk atau informasi pengiriman sebelum menyimpan.
          </div>
        )}
        {addressError && (
          <div role="alert" className={`${alertBox} mb-5`}>
            Alamat pengiriman: {addressError}
          </div>
        )}

        {/* Shipping detail (when set) */}
        {(shippingAddress || shippingTime || shippingCost) && (
          <div className={`${card} ${grid2} mb-6 gap-6`}>
            <div>
              <div className={fieldLabel}>WAKTU PENGIRIMAN (HARI)</div>
              <div className={`${fieldValue} mt-1`}>
                {shippingTime ? `${shippingTime} hari` : "-"}
              </div>
            </div>
            <div>
              <div className={fieldLabel}>BIAYA PENGIRIMAN</div>
              <div className={`${fieldValueBold} mt-1`}>
                Rp {formatRp(Number(shippingCost) || 0)}
              </div>
            </div>
          </div>
        )}

        {/* Detail Produk - collapsible */}
        {products.length > 0 && (
          <div className="mb-6">
            {/* Header row */}
            <div
              className={`flex flex-wrap items-center justify-between gap-3 border border-[rgba(204,195,216,0.2)] bg-white px-5 py-3.5 ${
                prodExpanded ? "rounded-t-lg border-b-[rgba(204,195,216,0.15)]" : "rounded-lg"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-bold uppercase tracking-[0.5px] text-[#111827]">
                  Detail Produk
                </span>
                <span className="text-xs font-medium text-[#9CA3AF]">{products.length} produk</span>
              </div>
              <div className="flex items-center gap-3">
                {/* Pagination — always visible */}
                <PageButtons
                  currentPage={page}
                  totalPages={totalPages}
                  onPage={setProdPage}
                  dimDisabled
                />
                {/* Toggle */}
                <button
                  type="button"
                  onClick={() => setProdExpanded((e) => !e)}
                  aria-expanded={prodExpanded}
                  className={`flex items-center gap-[5px] rounded-sm border border-[rgba(204,195,216,0.5)] px-2.5 py-[5px] text-xs font-medium text-[#6B7280] ${ui.focusRing}`}
                >
                  {prodExpanded ? "Sembunyikan" : "Tampilkan"}
                  <svg
                    aria-hidden="true"
                    width="10"
                    height="6"
                    viewBox="0 0 10 6"
                    fill="none"
                    className={`motion-safe:transition-transform motion-safe:duration-200 ${
                      prodExpanded ? "" : "rotate-180"
                    }`}
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

            {/* Product cards */}
            {prodExpanded && (
              <div className="rounded-b-lg border border-t-0 border-[rgba(204,195,216,0.2)] bg-white p-5">
                <div className="flex flex-col gap-4">
                  {pageSlice.map((p, i) => {
                    const globalIndex = (page - 1) * PAGE_SIZE + i + 1
                    const profit = p.hargaJual - p.hargaBeli
                    const profitPct =
                      p.hargaBeli > 0 ? ((profit / p.hargaBeli) * 100).toFixed(2) : "0.00"
                    const requestNama = p.requestedNama || p.nama
                    const requestKode = requestedCode(p)
                    const isDifferent = requestDiffers(p)
                    return (
                      <div key={p.id} className={`${qep.card} mb-0`}>
                        <div className={qep.cardHeader}>
                          <div className={qep.cardMeta}>
                            <span className={qep.cardLabel}>PRODUK {globalIndex}</span>
                          </div>
                        </div>
                        <RequestOffer
                          request={{ kode: requestKode, nama: requestNama }}
                          offer={{ kode: p.kodeImpa, nama: p.nama }}
                          differs={isDifferent}
                        />
                        <div className={qep.cardBody}>
                          <div className={qep.col}>
                            <div className={qep.field}>
                              <span className={qep.fieldLabel}>VENDOR</span>
                              <div className={qep.fieldInput}>{p.vendor}</div>
                            </div>
                            <div className={qep.field}>
                              <span className={qep.fieldLabel}>JUMLAH</span>
                              <div className={qep.fieldInput}>{p.jumlah}</div>
                            </div>
                            <div className={qep.field}>
                              <span className={qep.fieldLabel}>SATUAN</span>
                              <div className={qep.fieldInput}>{p.satuan}</div>
                            </div>
                          </div>
                          <div className={qep.col}>
                            <div className={qep.field}>
                              <span className={qep.fieldLabel}>HARGA BELI SATUAN</span>
                              <div className={qep.fieldInput}>
                                <span className={qep.rp}>Rp</span> {formatRp(p.hargaBeli)}
                              </div>
                            </div>
                            <div className={qep.field}>
                              <span className={qep.fieldLabel}>HARGA JUAL SATUAN</span>
                              <div className={qep.fieldInput}>
                                <span className={qep.rp}>Rp</span> {formatRp(p.hargaJual)}
                              </div>
                            </div>
                            <div className={qep.field}>
                              <span className={qep.fieldLabel}>PROFIT</span>
                              <div className={qep.fieldInput}>
                                <span className={qep.rp}>Rp</span> {formatRp(profit)}{" "}
                                <span className={qep.profitPct}>({profitPct}%)</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Summary totals */}
        <div className="rounded-lg border border-[rgba(204,195,216,0.1)] bg-dark-50 p-6">
          <div className="mb-5 text-[13px] font-bold uppercase tracking-[0.5px] text-[#6B7280]">
            Rincian Biaya
          </div>

          <div className="mb-5 flex flex-col gap-3">
            <div className={costRow}>
              <span>Total Produk</span>
              <span className={costValue}>{summaryTotalProdukQty} Produk</span>
            </div>
            <div className={costRow}>
              <span>Total Harga Beli</span>
              <span className={costValue}>Rp {formatRp(summaryTotalHargaBeli)}</span>
            </div>
            <div className={costRow}>
              <span>Total Harga Jual</span>
              <span className={costValue}>Rp {formatRp(summaryTotalHargaJual)}</span>
            </div>
            {discountPct > 0 && (
              <div className={costRow}>
                <span>Diskon ({discountPct}%)</span>
                <span className="font-semibold text-[#10B981]">- Rp {formatRp(nominalDiskon)}</span>
              </div>
            )}
            <div className={costRow}>
              <span>Sub Total</span>
              <div className="flex items-center gap-2">
                {discountPct > 0 && (
                  <span className="text-[#9CA3AF] line-through">
                    Rp {formatRp(summaryTotalHargaJual)}
                  </span>
                )}
                <span className={costValue}>Rp {formatRp(summarySubTotal)}</span>
              </div>
            </div>
            <div className={costRow}>
              <span>DPP Nilai Lain</span>
              <span className={costValue}>Rp {formatRp(summaryDpp)}</span>
            </div>
            <div className={costRow}>
              <span>PPN 12%</span>
              <span className={costValue}>Rp {formatRp(summaryPpn)}</span>
            </div>
            <div className={costRow}>
              <span>Biaya Pengiriman</span>
              <span className={costValue}>Rp {formatRp(summaryShippingCost)}</span>
            </div>
          </div>

          <div className="mb-4 h-px bg-[#E5E7EB]" />

          <div className="mb-5 flex justify-between text-[11px] font-bold uppercase text-[#6B7280]">
            <span>Total Estimasi Profit</span>
            <span className="text-xs text-primary-700">Rp {formatRp(summaryProfit)}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[1px] text-[#6B7280]">
              Grand Total
            </span>
            <span className="text-[28px] font-extrabold tracking-[-0.5px] text-primary-700">
              Rp {formatRp(summaryGrandTotal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
