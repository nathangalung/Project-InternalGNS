import { useState } from "react"
import { getPageNumbers } from "@/lib/pagination"
import type { ProductItem } from "./QuotationEdit"
import type { Client } from "./Step1Client"
import { qe, qep } from "./wizard-styles"

interface Step4SummaryProps {
  jatuhTempo: string
  setJatuhTempo: (s: string) => void
  berlakuSampai: string
  setBerlakuSampai: (s: string) => void
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
const formInput =
  "box-border w-full rounded-md border border-[rgba(204,195,216,0.2)] bg-dark-50 px-4 py-3 text-sm text-[#111827] outline-none"
const alertBox =
  "rounded-md border border-[rgba(239,68,68,0.18)] bg-[rgba(239,68,68,0.06)] px-3.5 py-2.5 text-xs font-medium text-[#DC2626]"
const pageBtn = "flex h-8 w-8 items-center justify-center rounded-sm text-sm transition"
const pageBtnIdle = "font-medium text-[#4A4455] hover:bg-dark-100"
const pageBtnActive = "bg-primary-700 font-bold text-white"
const pageBtnNav =
  "flex items-center justify-center rounded-sm border border-[#CCC3D8] p-2 transition hover:bg-dark-100"
const costRow = "flex justify-between text-xs text-[#4B5563]"
const costValue = "font-semibold text-[#111827]"

export default function Step4Summary({
  jatuhTempo,
  setJatuhTempo,
  berlakuSampai,
  setBerlakuSampai,
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
}: Step4SummaryProps) {
  const [prodPage, setProdPage] = useState(1)
  const [prodExpanded, setProdExpanded] = useState(true)

  const totalPages = Math.ceil(products.length / PAGE_SIZE) || 1
  const pageSlice = products.slice((prodPage - 1) * PAGE_SIZE, prodPage * PAGE_SIZE)

  const isTenggatWaktuFilled = jatuhTempo.trim().length > 0 && berlakuSampai.trim().length > 0
  const hasContent =
    products.length > 0 || (shippingAddress.trim().length >= 20 && /[a-zA-Z]/.test(shippingAddress))

  return (
    <div className={qe.stepContent}>
      {/* Tenggat Waktu Penawaran */}
      <div>
        <h2 className={`${qe.sectionTitle} mb-3`}>Tenggat Waktu Penawaran</h2>
        <div className={`${card} ${grid2} gap-6`}>
          <div>
            <label className={formLabel}>
              JATUH TEMPO PEMBAYARAN (HARI) <span className="text-error">*</span>
            </label>
            <input
              type="number"
              min="1"
              placeholder="Masukkan hari sampai jatuh tempo"
              value={jatuhTempo}
              onChange={(e) => setJatuhTempo(e.target.value)}
              className={formInput}
            />
          </div>
          <div>
            <label className={formLabel}>
              BERLAKU SAMPAI (HARI) <span className="text-error">*</span>
            </label>
            <input
              type="number"
              min="1"
              placeholder="Masukkan jumlah hari"
              value={berlakuSampai}
              onChange={(e) => setBerlakuSampai(e.target.value)}
              className={formInput}
            />
          </div>
        </div>
        {!isTenggatWaktuFilled && (
          <div className={`${alertBox} mt-2.5`}>
            Jatuh tempo pembayaran dan berlaku sampai wajib diisi sebelum menyimpan.
          </div>
        )}
      </div>

      {/* Ringkasan Klien */}
      <div>
        <h2 className={`${qe.sectionTitle} mb-3`}>Ringkasan Klien</h2>
        <div className="overflow-hidden rounded-lg border border-[rgba(204,195,216,0.2)] bg-white">
          {/* Card header with avatar */}
          <div className="flex items-center gap-4 border-b border-[rgba(204,195,216,0.15)] bg-[linear-gradient(135deg,rgba(99,14,212,0.04)_0%,rgba(99,14,212,0.01)_100%)] px-6 py-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[rgba(99,14,212,0.12)]">
              <span className="text-base font-extrabold tracking-[-0.5px] text-primary-700">
                {currentClient?.initials || "—"}
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
              <div>
                <div className={fieldLabel}>Reference Number</div>
                <div className={currentClient?.referenceNumber ? fieldValue : emptyValue}>
                  {currentClient?.referenceNumber || "Belum diisi"}
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

        {/* Shipping detail (when set) */}
        {shippingAddress && (
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
              className={`flex items-center justify-between border border-[rgba(204,195,216,0.2)] bg-white px-5 py-3.5 ${
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
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={pageBtnNav}
                    disabled={prodPage === 1}
                    onClick={() => setProdPage((p) => Math.max(1, p - 1))}
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
                  {getPageNumbers(prodPage, totalPages).map((n, i) =>
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
                        onClick={() => setProdPage(n)}
                        className={`${pageBtn} ${n === prodPage ? pageBtnActive : pageBtnIdle}`}
                      >
                        {n}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    className={pageBtnNav}
                    disabled={prodPage === totalPages}
                    onClick={() => setProdPage((p) => Math.min(totalPages, p + 1))}
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
                {/* Toggle */}
                <button
                  type="button"
                  onClick={() => setProdExpanded((e) => !e)}
                  className="flex items-center gap-[5px] rounded-sm border border-[rgba(204,195,216,0.5)] px-2.5 py-[5px] text-xs font-medium text-[#6B7280]"
                >
                  {prodExpanded ? "Sembunyikan" : "Tampilkan"}
                  <svg
                    width="10"
                    height="6"
                    viewBox="0 0 10 6"
                    fill="none"
                    className={`transition-transform duration-200 ${
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
                    const globalIndex = (prodPage - 1) * PAGE_SIZE + i + 1
                    const profit = p.hargaJual - p.hargaBeli
                    const profitPct =
                      p.hargaBeli > 0 ? ((profit / p.hargaBeli) * 100).toFixed(2) : "0.00"
                    const requestNama = p.requestedNama || p.nama
                    const requestKode = p.requestedKodeImpa || p.kodeImpa
                    const isDifferent = requestNama !== p.nama || requestKode !== p.kodeImpa
                    return (
                      <div key={p.id} className={`${qep.card} mb-0`}>
                        <div className={qep.cardHeader}>
                          <div className={qep.cardMeta}>
                            <span className={qep.cardLabel}>PRODUK {globalIndex}</span>
                            <span className={qep.cardName}>{p.nama}</span>
                            {p.kodeImpa && (
                              <span className={qep.cardCode}>KODE IMPA: {p.kodeImpa}</span>
                            )}
                          </div>
                        </div>
                        <div
                          className={`border-y border-[rgba(204,195,216,0.2)] px-5 py-3 ${
                            isDifferent ? "bg-[rgba(245,158,11,0.04)]" : "bg-[rgba(99,14,212,0.02)]"
                          }`}
                        >
                          <div className="mb-1.5 flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-[0.6px] ${
                                isDifferent ? "text-[#B45309]" : "text-[#6B7280]"
                              }`}
                            >
                              Permintaan Klien
                            </span>
                            {isDifferent && (
                              <span className="rounded-[4px] bg-[rgba(245,158,11,0.15)] px-1.5 py-0.5 text-[10px] font-semibold text-[#B45309]">
                                Berbeda dari Offer
                              </span>
                            )}
                          </div>
                          <div className="flex gap-6 text-[13px] text-[#374151]">
                            <div>
                              <span className="mr-1.5 text-[#9CA3AF]">Kode IMPA:</span>
                              <span className="font-semibold">{requestKode || "-"}</span>
                            </div>
                            <div>
                              <span className="mr-1.5 text-[#9CA3AF]">Nama:</span>
                              <span className="font-semibold">{requestNama || "-"}</span>
                            </div>
                          </div>
                        </div>
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
