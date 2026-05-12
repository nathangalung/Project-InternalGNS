import type React from "react"
import { useState } from "react"
import { getPageNumbers } from "@/lib/pagination"
import type { ProductItem } from "./QuotationEdit"
import type { Client } from "./Step1Client"

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

const card: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid rgba(204, 195, 216, 0.2)",
  borderRadius: "12px",
  padding: "24px",
}
const fieldLabel: React.CSSProperties = {
  fontSize: "11px",
  color: "#6B7280",
  fontWeight: 600,
  textTransform: "uppercase",
  marginBottom: "4px",
}
const fieldValue: React.CSSProperties = { fontSize: "14px", fontWeight: 500, color: "#111827" }

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
    <div className="qe-step-content">
      {/* Tenggat Waktu Penawaran */}
      <div>
        <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>
          Tenggat Waktu Penawaran
        </h2>
        <div style={{ ...card, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 700,
                color: "#6B7280",
                letterSpacing: "0.5px",
                marginBottom: "8px",
                textTransform: "uppercase",
              }}
            >
              JATUH TEMPO PEMBAYARAN (HARI) <span style={{ color: "#EF4444" }}>*</span>
            </label>
            <input
              type="number"
              min="1"
              placeholder="Masukkan hari sampai jatuh tempo"
              value={jatuhTempo}
              onChange={(e) => setJatuhTempo(e.target.value)}
              style={{
                width: "100%",
                background: "#F8FAFC",
                border: "1px solid rgba(204,195,216,0.2)",
                outline: "none",
                padding: "12px 16px",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#111827",
                boxSizing: "border-box",
                fontFamily: "'Inter', sans-serif",
              }}
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 700,
                color: "#6B7280",
                letterSpacing: "0.5px",
                marginBottom: "8px",
                textTransform: "uppercase",
              }}
            >
              BERLAKU SAMPAI (HARI) <span style={{ color: "#EF4444" }}>*</span>
            </label>
            <input
              type="number"
              min="1"
              placeholder="Masukkan jumlah hari"
              value={berlakuSampai}
              onChange={(e) => setBerlakuSampai(e.target.value)}
              style={{
                width: "100%",
                background: "#F8FAFC",
                border: "1px solid rgba(204,195,216,0.2)",
                outline: "none",
                padding: "12px 16px",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#111827",
                boxSizing: "border-box",
                fontFamily: "'Inter', sans-serif",
              }}
            />
          </div>
        </div>
        {!isTenggatWaktuFilled && (
          <div
            style={{
              marginTop: "10px",
              padding: "10px 14px",
              borderRadius: "8px",
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.18)",
              fontSize: "12px",
              color: "#DC2626",
              fontWeight: 500,
            }}
          >
            Jatuh tempo pembayaran dan berlaku sampai wajib diisi sebelum menyimpan.
          </div>
        )}
      </div>

      {/* Ringkasan Klien */}
      <div>
        <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>
          Ringkasan Klien
        </h2>
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid rgba(204,195,216,0.2)",
            borderRadius: "12px",
            overflow: "hidden",
          }}
        >
          {/* Card header with avatar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              padding: "20px 24px",
              borderBottom: "1px solid rgba(204,195,216,0.15)",
              background:
                "linear-gradient(135deg, rgba(99,14,212,0.04) 0%, rgba(99,14,212,0.01) 100%)",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                background: "rgba(99,14,212,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: "16px",
                  fontWeight: 800,
                  color: "#630ED4",
                  letterSpacing: "-0.5px",
                }}
              >
                {currentClient?.initials || "—"}
              </span>
            </div>
            <div>
              <div
                style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}
              >
                {currentClient?.name || "-"}
              </div>
              <span style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>
                {currentClient?.country || "-"}
              </span>
            </div>
          </div>

          {/* Contact & legal info */}
          <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(204,195,216,0.15)" }}>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#9CA3AF",
                letterSpacing: "1px",
                textTransform: "uppercase",
                marginBottom: "16px",
              }}
            >
              Kontak &amp; Legalitas
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                rowGap: "20px",
                columnGap: "24px",
              }}
            >
              <div>
                <div style={fieldLabel}>Narahubung</div>
                <div style={{ ...fieldValue, fontWeight: 600 }}>
                  {currentClient?.narahubung || "-"}
                </div>
              </div>
              <div>
                <div style={fieldLabel}>Nomor HP</div>
                <div style={fieldValue}>{currentClient?.phone || "-"}</div>
              </div>
              <div>
                <div style={fieldLabel}>Email Kontak</div>
                <div style={fieldValue}>{currentClient?.email || "-"}</div>
              </div>
              <div>
                <div style={fieldLabel}>Nomor TKU</div>
                <div
                  style={{
                    ...fieldValue,
                    color: currentClient?.nomorTKU ? "#111827" : "#9CA3AF",
                    fontStyle: currentClient?.nomorTKU ? "normal" : "italic",
                  }}
                >
                  {currentClient?.nomorTKU || "Belum diisi"}
                </div>
              </div>
              <div>
                <div style={fieldLabel}>NPWP</div>
                <div
                  style={{
                    ...fieldValue,
                    color: currentClient?.npwp ? "#111827" : "#9CA3AF",
                    fontStyle: currentClient?.npwp ? "normal" : "italic",
                  }}
                >
                  {currentClient?.npwp || "Belum diisi"}
                </div>
              </div>
              <div>
                <div style={fieldLabel}>Reference Number</div>
                <div
                  style={{
                    ...fieldValue,
                    color: currentClient?.referenceNumber ? "#111827" : "#9CA3AF",
                    fontStyle: currentClient?.referenceNumber ? "normal" : "italic",
                  }}
                >
                  {currentClient?.referenceNumber || "Belum diisi"}
                </div>
              </div>
            </div>
          </div>

          {/* Addresses */}
          <div
            style={{
              padding: "20px 24px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "24px",
            }}
          >
            <div>
              <div style={fieldLabel}>Lokasi Perusahaan</div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  lineHeight: "1.6",
                  marginTop: "4px",
                  color: currentClient?.lokasi ? "#374151" : "#9CA3AF",
                  fontStyle: currentClient?.lokasi ? "normal" : "italic",
                }}
              >
                {currentClient?.lokasi || "Belum diisi"}
              </div>
            </div>
            <div>
              <div style={fieldLabel}>Alamat Pengiriman Barang</div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  lineHeight: "1.6",
                  marginTop: "4px",
                  color: shippingAddress ? "#374151" : "#9CA3AF",
                  fontStyle: shippingAddress ? "normal" : "italic",
                }}
              >
                {shippingAddress || "Belum diisi"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ringkasan Penawaran */}
      <div>
        <h2 className="qe-section-title" style={{ marginBottom: "12px" }}>
          Ringkasan Penawaran
        </h2>

        {!hasContent && (
          <div
            style={{
              marginBottom: "20px",
              padding: "10px 14px",
              borderRadius: "8px",
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.18)",
              fontSize: "12px",
              color: "#DC2626",
              fontWeight: 500,
            }}
          >
            Isi minimal satu produk atau informasi pengiriman sebelum menyimpan.
          </div>
        )}

        {/* Shipping detail (when set) */}
        {shippingAddress && (
          <div
            style={{
              ...card,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "24px",
              marginBottom: "24px",
            }}
          >
            <div>
              <div style={fieldLabel}>WAKTU PENGIRIMAN (HARI)</div>
              <div style={{ ...fieldValue, marginTop: "4px" }}>
                {shippingTime ? `${shippingTime} hari` : "-"}
              </div>
            </div>
            <div>
              <div style={fieldLabel}>BIAYA PENGIRIMAN</div>
              <div style={{ ...fieldValue, fontWeight: 700, color: "#111827", marginTop: "4px" }}>
                Rp {formatRp(Number(shippingCost) || 0)}
              </div>
            </div>
          </div>
        )}

        {/* Detail Produk - collapsible */}
        {products.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            {/* Header row */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 20px",
                background: "#FFFFFF",
                border: "1px solid rgba(204,195,216,0.2)",
                borderRadius: prodExpanded ? "12px 12px 0 0" : "12px",
                borderBottom: prodExpanded
                  ? "1px solid rgba(204,195,216,0.15)"
                  : "1px solid rgba(204,195,216,0.2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#111827",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Detail Produk
                </span>
                <span style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 500 }}>
                  {products.length} produk
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {/* Pagination — always visible */}
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
                {/* Toggle */}
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

            {/* Product cards */}
            {prodExpanded && (
              <div
                style={{
                  background: "#FFFFFF",
                  border: "1px solid rgba(204,195,216,0.2)",
                  borderTop: "none",
                  borderRadius: "0 0 12px 12px",
                  padding: "20px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {pageSlice.map((p, i) => {
                    const globalIndex = (prodPage - 1) * PAGE_SIZE + i + 1
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
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 6,
                            }}
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
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Summary totals */}
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
              <span style={{ fontWeight: 600, color: "#111827" }}>
                {summaryTotalProdukQty} Produk
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
                color: "#4B5563",
              }}
            >
              <span>Biaya Pengiriman</span>
              <span style={{ fontWeight: 600, color: "#111827" }}>
                Rp {formatRp(summaryShippingCost)}
              </span>
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
              style={{
                fontSize: "28px",
                fontWeight: 800,
                color: "#630ED4",
                letterSpacing: "-0.5px",
              }}
            >
              Rp {formatRp(summaryGrandTotal)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
