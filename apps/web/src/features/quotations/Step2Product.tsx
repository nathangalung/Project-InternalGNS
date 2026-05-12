import type React from "react"
import { useRef, useState } from "react"
import { matchRows } from "@/features/items/api"
import { getPageNumbers } from "@/lib/pagination"
import type { ProductItem } from "./QuotationEdit"
import QuotationReviewCard from "./QuotationReviewCard"
import { parseProductFile } from "./uploadParser"

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

// CSV → AOA → MatchRowInput[] handled by parseProductFile (xlsx + csv).

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
    const supported = lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")
    if (!supported) {
      setImportMsg({
        text: "Format file tidak didukung. Gunakan .csv, .xlsx, atau .xls.",
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

      const resp = await matchRows(rows)
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
      const matchedCount = resp.rows.filter((r) => r.matched).length
      setImportMsg({
        text: `${built.length} produk diimport (${matchedCount} cocok dengan katalog, ${built.length - matchedCount} kosong).`,
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
    <div className="qe-step-content">
      {quotationId !== undefined && <QuotationReviewCard quotationId={quotationId} />}
      {/* Header */}
      <div className="qe-section-header">
        <div>
          <h2 className="qe-section-title">Pilih Produk &amp; Harga</h2>
          <p className="qe-section-desc">Tentukan produk dan harga penawaran.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            ref={importFileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
          <button
            className="qe-add-client-btn"
            style={{
              width: "210px",
              justifyContent: "center",
              opacity: importing ? 0.6 : 1,
              cursor: importing ? "wait" : "pointer",
            }}
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
            className="qe-add-client-btn"
            style={{ width: "210px", justifyContent: "center" }}
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
            className="qe-add-client-btn"
            style={{ width: "210px", justifyContent: "center" }}
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
          style={{
            padding: "10px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 500,
            fontFamily: "'Inter', sans-serif",
            background: importMsg.ok ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
            color: importMsg.ok ? "#059669" : "#DC2626",
            border: `1px solid ${importMsg.ok ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
          }}
        >
          {importMsg.text}
        </div>
      )}

      {/* Product section */}
      <div>
        {/* Toolbar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 20px",
            background: "#FFFFFF",
            border: "1px solid rgba(204,195,216,0.2)",
            borderRadius: prodExpanded ? "12px 12px 0 0" : "12px",
            borderBottom: prodExpanded
              ? "1px solid rgba(204,195,216,0.15)"
              : "1px solid rgba(204,195,216,0.2)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ position: "relative", display: "inline-block" }}>
              <button
                onClick={() => setIsRowDropdownOpen(!isRowDropdownOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "5px 10px",
                  borderRadius: "6px",
                  border: "1px solid #E2E8F0",
                  background: "#fff",
                  cursor: "pointer",
                  fontSize: "13px",
                  color: "#4A4455",
                  fontFamily: "'Inter', sans-serif",
                }}
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
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 8px)",
                    left: 0,
                    background: "#fff",
                    border: "1px solid rgba(204,195,216,0.2)",
                    boxShadow: "0px 4px 16px rgba(0,0,0,0.08)",
                    borderRadius: "8px",
                    display: "flex",
                    flexDirection: "column",
                    padding: "8px 0",
                    width: "140px",
                    zIndex: 50,
                  }}
                >
                  {[5, 10, 15].map((val) => {
                    const isActive = prodPageSize === val
                    return (
                      <button
                        key={val}
                        onClick={() => {
                          setProdPageSize(val)
                          setProdPage(1)
                          setIsRowDropdownOpen(false)
                        }}
                        style={{
                          display: "flex",
                          justifyContent: isActive ? "space-between" : "flex-start",
                          alignItems: "center",
                          padding: "4px 16px",
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
            <span style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>
              Menampilkan {totalProds === 0 ? 0 : start + 1}–
              {Math.min(start + prodPageSize, totalProds)} dari {totalProds} produk
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div className="page-buttons">
              <button
                className="page-btn-nav"
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
                    onClick={() => setProdPage(n)}
                    className={`page-btn${n === prodPage ? " page-btn--active" : ""}`}
                  >
                    {n}
                  </button>
                ),
              )}
              <button
                className="page-btn-nav"
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
              onClick={() => setProdExpanded((e) => !e)}
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
              {prodExpanded ? "Sembunyikan" : "Tampilkan"}
              <svg
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                style={{
                  transform: prodExpanded ? "rotate(0deg)" : "rotate(180deg)",
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

        {/* Cards */}
        {prodExpanded && (
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid rgba(204,195,216,0.2)",
              borderTop: "none",
              borderRadius: "0 0 12px 12px",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {products.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "48px 0",
                  color: "#9CA3AF",
                  fontSize: "14px",
                }}
              >
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
                  <div key={p.id} className="qep-card" style={{ marginBottom: 0 }}>
                    <div className="qep-card-header">
                      <div className="qep-card-meta">
                        <span className="qep-card-label">PRODUK {globalIndex}</span>
                        <span className="qep-card-name">{p.nama}</span>
                        {p.kodeImpa && (
                          <span className="qep-card-code">KODE IMPA: {p.kodeImpa}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                        <button
                          onClick={() => {
                            setEditingProduct(p)
                            setShowProductAdd(true)
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "#630ED4",
                          }}
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
                          onClick={() => deleteProduct(p.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "#EF4444",
                          }}
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
                      style={{
                        padding: "12px 20px",
                        borderTop: "1px solid rgba(204,195,216,0.2)",
                        borderBottom: "1px solid rgba(204,195,216,0.2)",
                        background: isDifferent
                          ? "rgba(245, 158, 11, 0.04)"
                          : "rgba(99, 14, 212, 0.02)",
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.6px",
                            textTransform: "uppercase",
                            color: isDifferent ? "#B45309" : "#6B7280",
                          }}
                        >
                          Permintaan Klien
                        </span>
                        {isDifferent && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "rgba(245, 158, 11, 0.15)",
                              color: "#B45309",
                            }}
                          >
                            Berbeda dari Offer
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 24, fontSize: 13, color: "#374151" }}>
                        <div>
                          <span style={{ color: "#9CA3AF", marginRight: 6 }}>Kode IMPA:</span>
                          <span style={{ fontWeight: 600 }}>{requestKode || "-"}</span>
                        </div>
                        <div>
                          <span style={{ color: "#9CA3AF", marginRight: 6 }}>Nama:</span>
                          <span style={{ fontWeight: 600 }}>{requestNama || "-"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="qep-card-body">
                      <div className="qep-col-left">
                        <div className="qep-field">
                          <span className="qep-field-label">VENDOR</span>
                          <div className="qep-field-input">{p.vendor}</div>
                        </div>
                        <div className="qep-field">
                          <span className="qep-field-label">JUMLAH</span>
                          <div className="qep-field-input">{p.jumlah}</div>
                        </div>
                        <div className="qep-field">
                          <span className="qep-field-label">SATUAN</span>
                          <div className="qep-field-input">{p.satuan}</div>
                        </div>
                      </div>
                      <div className="qep-col-right">
                        <div className="qep-field">
                          <span className="qep-field-label">HARGA BELI SATUAN</span>
                          <div className="qep-field-input">
                            <span className="qep-rp">Rp</span> {formatRp(p.hargaBeli)}
                          </div>
                        </div>
                        <div className="qep-field">
                          <span className="qep-field-label">HARGA JUAL SATUAN</span>
                          <div className="qep-field-input">
                            <span className="qep-rp">Rp</span> {formatRp(p.hargaJual)}
                          </div>
                        </div>
                        <div className="qep-field">
                          <span className="qep-field-label">PROFIT</span>
                          <div className="qep-field-input">
                            <span className="qep-rp">Rp</span> {formatRp(profit)}{" "}
                            <span className="qep-profit-pct">({profitPct}%)</span>
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
      <div
        style={{
          background: "#F8FAFC",
          borderRadius: "12px",
          padding: "24px",
          border: "1px solid rgba(204,195,216,0.1)",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "#6B7280",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            marginBottom: "20px",
          }}
        >
          Rincian Biaya
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>Total Produk</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>{totalProds} Produk</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>Total Harga Beli</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>
              Rp {formatRp(summaryTotalHargaBeli)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>Total Harga Jual</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>
              Rp {formatRp(summaryTotalHargaJual)}
            </span>
          </div>
          {discountPct > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
                color: "#4B5563",
              }}
            >
              <span>Diskon ({discountPct}%)</span>
              <span style={{ fontWeight: 600, color: "#10B981" }}>
                - Rp {formatRp(nominalDiskon)}
              </span>
            </div>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>Sub Total</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {discountPct > 0 && (
                <span style={{ textDecoration: "line-through", color: "#9CA3AF" }}>
                  Rp {formatRp(summaryTotalHargaJual)}
                </span>
              )}
              <span style={{ fontWeight: 600, color: "#111827" }}>
                Rp {formatRp(summarySubTotal)}
              </span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>DPP Nilai Lain</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>Rp {formatRp(summaryDpp)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "#4B5563",
            }}
          >
            <span>PPN 12%</span>
            <span style={{ fontWeight: 600, color: "#111827" }}>Rp {formatRp(summaryPpn)}</span>
          </div>
        </div>

        <div style={{ height: "1px", background: "#E5E7EB", marginBottom: "16px" }} />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "11px",
            fontWeight: 700,
            color: "#6B7280",
            textTransform: "uppercase",
            marginBottom: "20px",
          }}
        >
          <span>Total Estimasi Profit</span>
          <span style={{ color: "#630ED4", fontSize: "12px" }}>Rp {formatRp(summaryProfit)}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#6B7280",
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            Grand Total
          </span>
          <span
            style={{ fontSize: "28px", fontWeight: 800, color: "#630ED4", letterSpacing: "-0.5px" }}
          >
            Rp {formatRp(summarySubTotal + summaryPpn)}
          </span>
        </div>
      </div>
    </div>
  )
}
