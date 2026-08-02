import type React from "react"
import { useRef, useState } from "react"
import { matchRows } from "@/features/items/api"
import { getPageNumbers } from "@/lib/pagination"
import type { ProductItem } from "./QuotationEdit"
import QuotationReviewCard from "./QuotationReviewCard"
import { parseProductFile } from "./uploadParser"
import { qe, qep } from "./wizard-styles"

const pageBtn = "flex h-8 w-8 items-center justify-center rounded-sm text-sm transition"
const pageBtnIdle = "font-medium text-[#4A4455] hover:bg-dark-100"
const pageBtnActive = "bg-primary-700 font-bold text-white"
const pageBtnNav =
  "flex items-center justify-center rounded-sm border border-[#CCC3D8] p-2 transition hover:bg-dark-100"
const costRow = "flex justify-between text-xs text-[#4B5563]"
const costValue = "font-semibold text-[#111827]"

interface Step2ProductProps {
  products: ProductItem[]
  deleteProduct: (id: number) => void
  setEditingProduct: (p: ProductItem | null) => void
  setShowProductAdd: (show: boolean) => void
  prodPageSize: number
  setProdPageSize: (size: number) => void
  prodPage: number
  setProdPage: (page: number | ((p: number) => number)) => void
  isRowDropdownOpen: boolean
  setIsRowDropdownOpen: (open: boolean) => void
  setShowDiscountModal: (show: boolean) => void
  discountPct: number
  formatRp: (n: number) => string
  summaryTotalHargaBeli: number
  summaryTotalHargaJual: number
  nominalDiskon: number
  summarySubTotal: number
  summaryDpp: number
  summaryPpn: number
  onImportProducts: (products: ProductItem[]) => void
  quotationId?: number
}

export default function Step2Product({
  products,
  deleteProduct,
  setEditingProduct,
  setShowProductAdd,
  prodPageSize,
  setProdPageSize,
  prodPage,
  setProdPage,
  isRowDropdownOpen,
  setIsRowDropdownOpen,
  setShowDiscountModal,
  discountPct,
  formatRp,
  summaryTotalHargaBeli,
  summaryTotalHargaJual,
  nominalDiskon,
  summarySubTotal,
  summaryDpp,
  summaryPpn,
  onImportProducts,
  quotationId,
}: Step2ProductProps) {
  const importFileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [prodExpanded, setProdExpanded] = useState(true)

  const [importing, setImporting] = useState(false)

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""

    const lower = file.name.toLowerCase()
    const supported = lower.endsWith(".xlsx") || lower.endsWith(".csv")
    if (!supported) {
      setImportMsg({
        text: "Format file tidak didukung. Gunakan .csv atau .xlsx (simpan ulang file .xls sebagai .xlsx).",
        ok: false,
      })
      setTimeout(() => setImportMsg(null), 4000)
      return
    }

    setImporting(true)
    try {
      const rows = await parseProductFile(file)
      if (rows.length === 0) {
        setImportMsg({
          text: "Tidak ada produk valid dalam file. Pastikan kolom 'Nama Produk' tersedia.",
          ok: false,
        })
        setTimeout(() => setImportMsg(null), 4000)
        return
      }

      const resp = await matchRows(rows, { autoCreate: true })
      const baseId = products.reduce((m, p) => Math.max(m, p.id), 0)
      const built: ProductItem[] = resp.rows.map((r, i) => {
        const m = r.matched
        const fallbackUnit = (r.requested.unit || "").toUpperCase()
        const fallbackImpa = (r.requested.impaCode || "").toUpperCase()
        return {
          id: baseId + i + 1,
          itemId: m?.itemId,
          vendorId: m?.vendorId ?? undefined,
          vendorProductId: m?.vendorProductId ?? undefined,
          nama: m?.itemName ?? r.requested.name,
          kodeImpa: (m?.impaCode ?? fallbackImpa) || "",
          requestedNama: r.requested.name,
          requestedKodeImpa: fallbackImpa,
          vendor: m?.vendorName ?? "",
          jumlah: r.requested.qty || 0,
          satuan: m?.defaultUnitCode ?? fallbackUnit,
          hargaBeli: m?.costPrice ? Number(m.costPrice) || 0 : 0,
          hargaJual: 0,
        }
      })
      onImportProducts(built)
      const createdCount = resp.rows.filter((r) => r.source === "CREATED").length
      const matchedCount = resp.rows.filter((r) => r.matched && r.source !== "CREATED").length
      setImportMsg({
        text: `${built.length} produk diimport (${matchedCount} cocok katalog, ${createdCount} produk baru, harga kosong).`,
        ok: true,
      })
    } catch (err) {
      setImportMsg({ text: `Gagal memproses file: ${(err as Error).message}`, ok: false })
    } finally {
      setImporting(false)
      setTimeout(() => setImportMsg(null), 5000)
    }
  }

  const totalProds = products.length
  const totalPages = Math.ceil(totalProds / prodPageSize) || 1
  const start = (prodPage - 1) * prodPageSize
  const summaryProfit = summarySubTotal - summaryTotalHargaBeli

  return (
    <div className={qe.stepContent}>
      {quotationId !== undefined && <QuotationReviewCard quotationId={quotationId} />}
      {/* Header */}
      <div className={qe.sectionHeader}>
        <div>
          <h2 className={qe.sectionTitle}>Pilih Produk &amp; Harga</h2>
          <p className={qe.sectionDesc}>Tentukan produk dan harga penawaran.</p>
        </div>
        <div className="flex items-center gap-2.5">
          <input
            ref={importFileRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            type="button"
            className={`${qe.addBtn} w-[210px] justify-center disabled:cursor-wait disabled:opacity-60`}
            onClick={() => importFileRef.current?.click()}
            disabled={importing}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {importing ? "Memproses…" : "Unggah Excel/CSV"}
          </button>
          <button
            type="button"
            className={`${qe.addBtn} w-[210px] justify-center`}
            onClick={() => setShowDiscountModal(true)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {discountPct > 0 ? `Diskon (${discountPct}%)` : "Tambah Diskon"}
          </button>
          <button
            type="button"
            className={`${qe.addBtn} w-[210px] justify-center`}
            onClick={() => {
              setEditingProduct(null)
              setShowProductAdd(true)
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Tambah Produk
          </button>
        </div>
      </div>

      {importMsg && (
        <div
          className={`rounded-md border px-4 py-2.5 text-[13px] font-medium ${
            importMsg.ok
              ? "border-[rgba(16,185,129,0.2)] bg-[rgba(16,185,129,0.08)] text-[#059669]"
              : "border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] text-[#DC2626]"
          }`}
        >
          {importMsg.text}
        </div>
      )}

      {/* Product section */}
      <div>
        {/* Toolbar */}
        <div
          className={`flex items-center justify-between border border-[rgba(204,195,216,0.2)] bg-white px-5 py-3 ${
            prodExpanded ? "rounded-t-lg border-b-[rgba(204,195,216,0.15)]" : "rounded-lg"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsRowDropdownOpen(!isRowDropdownOpen)}
                className="flex items-center gap-2 rounded-sm border border-dark-200 bg-white px-2.5 py-[5px] text-[13px] text-[#4A4455]"
              >
                {prodPageSize} Baris
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
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 flex w-[140px] flex-col rounded-md border border-[rgba(204,195,216,0.2)] bg-white py-2 shadow-[0px_4px_16px_rgba(0,0,0,0.08)]">
                  {[5, 10, 15].map((val) => {
                    const isActive = prodPageSize === val
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setProdPageSize(val)
                          setProdPage(1)
                          setIsRowDropdownOpen(false)
                        }}
                        className={`flex h-8 w-full items-center px-4 py-1 ${
                          isActive ? "justify-between" : "justify-start"
                        }`}
                      >
                        <span
                          className={`text-xs ${
                            isActive
                              ? "font-semibold text-primary-700"
                              : "font-normal text-[#4A4455]"
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
            <span className="text-xs font-medium text-[#6B7280]">
              Menampilkan {totalProds === 0 ? 0 : start + 1}–
              {Math.min(start + prodPageSize, totalProds)} dari {totalProds} produk
            </span>
          </div>
          <div className="flex items-center gap-3">
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
                className={`transition-transform duration-200 ${prodExpanded ? "" : "rotate-180"}`}
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

        {/* Cards */}
        {prodExpanded && (
          <div className="flex flex-col gap-4 rounded-b-lg border border-t-0 border-[rgba(204,195,216,0.2)] bg-white p-5">
            {products.length === 0 ? (
              <div className="py-12 text-center text-sm text-[#9CA3AF]">
                Belum ada produk. Klik "Tambah Produk" untuk mulai.
              </div>
            ) : (
              products.slice(start, start + prodPageSize).map((p, i) => {
                const globalIndex = start + i + 1
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
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProduct(p)
                            setShowProductAdd(true)
                          }}
                          className="text-primary-700"
                          title="Edit Produk"
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteProduct(p.id)}
                          className="text-error"
                          title="Hapus Produk"
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                          </svg>
                        </button>
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
              })
            )}
          </div>
        )}
      </div>

      {/* Rincian Biaya */}
      <div className="rounded-lg border border-[rgba(204,195,216,0.1)] bg-dark-50 p-6">
        <div className="mb-5 text-[13px] font-bold uppercase tracking-[0.5px] text-[#6B7280]">
          Rincian Biaya
        </div>

        <div className="mb-5 flex flex-col gap-3">
          <div className={costRow}>
            <span>Total Produk</span>
            <span className={costValue}>{totalProds} Produk</span>
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
            Rp {formatRp(summarySubTotal + summaryPpn)}
          </span>
        </div>
      </div>
    </div>
  )
}
