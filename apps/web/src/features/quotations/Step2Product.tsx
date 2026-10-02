import type React from "react"
import { useRef, useState } from "react"
import PageButtons from "@/components/shared/PageButtons"
import RowsPerPageMenu from "@/components/shared/RowsPerPageMenu"
import { matchRows, recommend } from "@/features/items/api"
import { clampPage, pageCount } from "@/lib/pagination"
import { ui } from "@/lib/ui"
import { parseRfq } from "./api"
import { importedLines, importSummary } from "./import"
import { isValidQty, lineGaps, QTY_ERROR, requestDiffers, requestedCode } from "./lines"
import QuotationReviewCard from "./QuotationReviewCard"
import { countUnknownUnits, type ProductItem, unitIssue } from "./wizard"
import { qe, qep } from "./wizard-styles"

const costRow = "flex justify-between text-xs text-[#4B5563]"
const costValue = "font-semibold text-[#111827]"
const cardIconBtn = `rounded-sm p-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${ui.focusRing}`

// Line state badges and toggle
const noOfferBadge =
  "mt-1 inline-block w-fit rounded-[4px] bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.4px] text-[#374151]"
const gapBadge =
  "mt-1 inline-block w-fit rounded-[4px] bg-[rgba(245,158,11,0.15)] px-1.5 py-0.5 text-[11px] font-semibold text-[#92400E]"
const noOfferToggle = `rounded-md border border-dark-200 px-2 py-1 text-xs font-medium text-dark-700 transition hover:bg-dark-100 aria-pressed:border-dark-700 disabled:cursor-not-allowed disabled:opacity-40 ${ui.focusRing}`
const editorBadge =
  "mt-1 inline-block w-fit rounded-[4px] bg-primary-50 px-1.5 py-0.5 text-[11px] font-semibold text-primary-700"

type Step2ProductProps = {
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
  // Server qty errors by card id
  qtyErrors?: Record<number, string>
  // Known unit ids by code
  unitIdByCode: Map<string, number>
  // Client whose history prices imports
  clientId?: number
  // Marks a line Tidak Ditawarkan
  toggleNoOffer?: (id: number) => void
  // Opens a line for editing, when claiming it first
  editProduct?: (p: ProductItem) => void
  // Editor names of lines other users hold
  lockedBy?: Record<number, string>
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
  qtyErrors = {},
  unitIdByCode,
  clientId,
  toggleNoOffer,
  editProduct,
  lockedBy = {},
}: Step2ProductProps) {
  // No unit warnings before the list loads
  const unitsReady = unitIdByCode.size > 0
  const importFileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [prodExpanded, setProdExpanded] = useState(true)

  const [importing, setImporting] = useState(false)

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""

    // The API checks the format and refuses a file without product rows.
    setImporting(true)
    try {
      const rows = await parseRfq(file)
      const resp = await matchRows(rows, { autoCreate: true })
      // One call prices every matched line for this client. The rows are
      // already matched (and new products created), so a failed call still
      // imports them, just unfilled.
      const itemIds = [...new Set(resp.rows.flatMap((r) => (r.matched ? [r.matched.itemId] : [])))]
      const recs = itemIds.length ? await recommend(itemIds, clientId).catch(() => []) : []
      const baseId = products.reduce((m, p) => Math.max(m, p.id), 0)
      const built = importedLines(resp.rows, recs, baseId)
      onImportProducts(built)
      const unknownUnits = unitsReady ? countUnknownUnits(built, unitIdByCode) : 0
      // Stays up: it says which lines still need work.
      setImportMsg({ text: importSummary(built, resp.rows, unknownUnits), ok: true })
    } catch (err) {
      setImportMsg({ text: `Gagal memproses file: ${(err as Error).message}`, ok: false })
    } finally {
      setImporting(false)
    }
  }

  const totalProds = products.length
  const totalPages = pageCount(totalProds, prodPageSize)
  // A removed line can leave the page past the end.
  const page = clampPage(prodPage, totalPages)
  const start = (page - 1) * prodPageSize
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
        <div className={qe.sectionActions}>
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
              aria-hidden="true"
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
              aria-hidden="true"
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
              aria-hidden="true"
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
          className={`flex flex-wrap items-center justify-between gap-3 border border-[rgba(204,195,216,0.2)] bg-white px-5 py-3 ${
            prodExpanded ? "rounded-t-lg border-b-[rgba(204,195,216,0.15)]" : "rounded-lg"
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <RowsPerPageMenu
              value={prodPageSize}
              options={[5, 10, 15]}
              onChange={(n) => {
                setProdPageSize(n)
                setProdPage(1)
              }}
              open={isRowDropdownOpen}
              onOpenChange={setIsRowDropdownOpen}
              triggerClassName={`flex items-center gap-2 rounded-sm border border-dark-200 bg-white px-2.5 py-[5px] text-[13px] text-[#4A4455] ${ui.focusRing}`}
              panelClassName="w-[140px] shadow-[0px_4px_16px_rgba(0,0,0,0.08)]"
              rowClassName="px-4"
            />
            <span className="text-xs font-medium text-[#6B7280]">
              Menampilkan {totalProds === 0 ? 0 : start + 1}–
              {Math.min(start + prodPageSize, totalProds)} dari {totalProds} produk
            </span>
          </div>
          <div className="flex items-center gap-3">
            <PageButtons
              currentPage={page}
              totalPages={totalPages}
              onPage={setProdPage}
              dimDisabled
            />
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
                className={`motion-safe:transition-transform motion-safe:duration-200 ${prodExpanded ? "" : "rotate-180"}`}
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
                const requestKode = requestedCode(p)
                const isDifferent = requestDiffers(p)
                const qtyError = qtyErrors[p.id] ?? (isValidQty(p.jumlah) ? undefined : QTY_ERROR)
                const unitError = unitsReady ? unitIssue(p.satuan, unitIdByCode) : null
                // Only a quotation has a send rule to fill in for
                const gaps = toggleNoOffer ? lineGaps(p) : []
                const editor = lockedBy[p.id]
                return (
                  <div key={p.id} className={`${qep.card} mb-0`}>
                    <div className={qep.cardHeader}>
                      <div className={qep.cardMeta}>
                        <span className={qep.cardLabel}>PRODUK {globalIndex}</span>
                        <span className={qep.cardName}>{p.nama}</span>
                        {p.kodeImpa && (
                          <span className={qep.cardCode}>KODE IMPA: {p.kodeImpa}</span>
                        )}
                        {p.noOffer ? (
                          <span className={noOfferBadge}>Tidak Ditawarkan</span>
                        ) : (
                          gaps.length > 0 && (
                            <span className={gapBadge}>Belum lengkap: {gaps.join(", ")}</span>
                          )
                        )}
                        {editor && <span className={editorBadge}>Sedang diedit oleh {editor}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        {toggleNoOffer && (
                          <button
                            type="button"
                            onClick={() => toggleNoOffer(p.id)}
                            disabled={Boolean(editor)}
                            aria-pressed={Boolean(p.noOffer)}
                            aria-label={`${p.noOffer ? "Tawarkan" : "Tidak Ditawarkan"} produk ${globalIndex}`}
                            className={noOfferToggle}
                          >
                            {p.noOffer ? "Tawarkan" : "Tidak Ditawarkan"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (editProduct) return editProduct(p)
                            setEditingProduct(p)
                            setShowProductAdd(true)
                          }}
                          disabled={Boolean(editor)}
                          className={`${cardIconBtn} text-primary-700`}
                          title="Edit Produk"
                          aria-label={`Edit produk ${globalIndex}`}
                        >
                          <svg
                            aria-hidden="true"
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
                          disabled={Boolean(editor)}
                          className={`${cardIconBtn} text-error`}
                          title="Hapus Produk"
                          aria-label={`Hapus produk ${globalIndex}`}
                        >
                          <svg
                            aria-hidden="true"
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
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-[#374151]">
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
                          <div
                            className={`${qep.fieldInput}${qtyError ? " ring-1 ring-[#DC2626]" : ""}`}
                          >
                            {p.jumlah}
                          </div>
                          {qtyError && (
                            <span role="alert" className="text-xs text-[#DC2626]">
                              {qtyError} Ubah produk ini sebelum menyimpan.
                            </span>
                          )}
                        </div>
                        <div className={qep.field}>
                          <span className={qep.fieldLabel}>SATUAN</span>
                          <div
                            className={`${qep.fieldInput}${unitError ? " ring-1 ring-[#DC2626]" : ""}`}
                          >
                            {p.satuan || "-"}
                          </div>
                          {unitError && (
                            <span role="alert" className="text-xs text-[#DC2626]">
                              {unitError} Pilih satuan lewat tombol edit sebelum menyimpan.
                            </span>
                          )}
                        </div>
                      </div>
                      {p.noOffer ? (
                        <div className={qep.col}>
                          <p className="m-0 text-sm leading-6 text-dark-600">
                            Tidak ditawarkan ke klien. Harga jual Rp 0, dan baris ini tidak masuk ke
                            PO.
                          </p>
                        </div>
                      ) : (
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
                      )}
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
