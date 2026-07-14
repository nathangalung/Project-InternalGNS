import type { ClientInfo } from "@/features/quotations/types"
import { fieldLabel, fieldValue } from "./helpers"

interface ClientSummaryCardProps {
  clientName: string
  clientInitials: string
  clientInfo?: ClientInfo
  shippingAlamat?: string
}

// Client header card.
export default function ClientSummaryCard({
  clientName,
  clientInitials,
  clientInfo,
  shippingAlamat,
}: ClientSummaryCardProps) {
  const ci = clientInfo
  return (
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
              {clientInitials}
            </span>
          </div>
          <div>
            <div
              style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}
            >
              {clientName}
            </div>
            <span style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>Indonesia</span>
          </div>
        </div>

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
            className="rgrid-3"
            style={{
              display: "grid",
              rowGap: "20px",
              columnGap: "24px",
            }}
          >
            <div>
              <div style={fieldLabel}>Narahubung</div>
              <div style={{ ...fieldValue, fontWeight: 600 }}>{ci?.narahubung || "-"}</div>
            </div>
            <div>
              <div style={fieldLabel}>Nomor HP</div>
              <div style={fieldValue}>{ci?.phone || "-"}</div>
            </div>
            <div>
              <div style={fieldLabel}>Email Kontak</div>
              <div style={fieldValue}>{ci?.email || "-"}</div>
            </div>
            <div>
              <div style={fieldLabel}>Nomor TKU</div>
              <div
                style={{
                  ...fieldValue,
                  color: ci?.nomorTKU ? "#111827" : "#9CA3AF",
                  fontStyle: ci?.nomorTKU ? "normal" : "italic",
                }}
              >
                {ci?.nomorTKU || "Belum diisi"}
              </div>
            </div>
            <div>
              <div style={fieldLabel}>NPWP</div>
              <div
                style={{
                  ...fieldValue,
                  color: ci?.npwp ? "#111827" : "#9CA3AF",
                  fontStyle: ci?.npwp ? "normal" : "italic",
                }}
              >
                {ci?.npwp || "Belum diisi"}
              </div>
            </div>
            <div>
              <div style={fieldLabel}>Reference Number</div>
              <div
                style={{
                  ...fieldValue,
                  color: ci?.referenceNumber ? "#111827" : "#9CA3AF",
                  fontStyle: ci?.referenceNumber ? "normal" : "italic",
                }}
              >
                {ci?.referenceNumber || "Belum diisi"}
              </div>
            </div>
          </div>
        </div>

        <div
          className="rgrid-2"
          style={{
            padding: "20px 24px",
            display: "grid",
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
                color: ci?.lokasi ? "#374151" : "#9CA3AF",
                fontStyle: ci?.lokasi ? "normal" : "italic",
              }}
            >
              {ci?.lokasi || "Belum diisi"}
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
                color: shippingAlamat ? "#374151" : "#9CA3AF",
                fontStyle: shippingAlamat ? "normal" : "italic",
              }}
            >
              {shippingAlamat || "Belum diisi"}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
