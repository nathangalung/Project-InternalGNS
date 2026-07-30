import { type CSSProperties, useEffect, useRef, useState } from "react"
import type { PoRow } from "./types"

interface UploadPoModalProps {
  row: PoRow
  hasExistingFile?: boolean
  onClose: () => void
  onSubmit: (file: File | null, details: { poNumber: string; poDate: string }) => void
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  backdropFilter: "blur(2px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: "24px",
}

const modalStyle: CSSProperties = {
  width: "min(560px, 100%)",
  background: "#FFFFFF",
  borderRadius: "16px",
  boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
}

export default function UploadPoModal({
  row,
  hasExistingFile = false,
  onClose,
  onSubmit,
}: UploadPoModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string>("")
  const [poNumber, setPoNumber] = useState(row.poNumber)
  const [poDate, setPoDate] = useState(row.poDate.slice(0, 10))
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [onClose])

  const formattedSize = file
    ? file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(file.size / 1024).toFixed(0)} KB`
    : ""

  function handlePick(f: File | undefined) {
    if (!f) return
    const okExt = /\.(pdf|doc|docx|jpg|jpeg|png)$/i.test(f.name)
    if (!okExt) {
      setError("Format file harus PDF, DOC, DOCX, JPG, atau PNG.")
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("Ukuran file maksimal 10 MB.")
      return
    }
    setError("")
    setFile(f)
  }

  const canSubmit = (hasExistingFile || file !== null) && poNumber.trim() !== "" && poDate !== ""

  function handleSubmit() {
    if (!hasExistingFile && !file) {
      setError("Berkas PO wajib diunggah.")
      return
    }
    if (!poNumber.trim()) {
      setError("Nomor PO wajib diisi.")
      return
    }
    if (!poDate) {
      setError("Tanggal PO wajib diisi.")
      return
    }
    onSubmit(file, { poNumber: poNumber.trim(), poDate })
  }

  return (
    <div className="ca-overlay" style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            borderBottom: "1px solid #ECEEF0",
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontFamily: "'Inter', sans-serif",
                fontWeight: 800,
                fontSize: "18px",
                lineHeight: "24px",
                color: "#191C1E",
              }}
            >
              {hasExistingFile ? "Ubah Detail Purchase Order" : "Upload Berkas Purchase Order"}
            </h3>
            <p
              style={{
                margin: "4px 0 0",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 400,
                fontSize: "13px",
                color: "#4A4455",
              }}
            >
              {row.poNumber} • {row.client}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: "#94A3B8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "24px" }}>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label
                htmlFor="po-number"
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Nomor PO <span style={{ color: "#DC2626" }}>*</span>
              </label>
              <input
                id="po-number"
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid #D1D5DB",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "13px",
                  color: "#191C1E",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label
                htmlFor="po-date"
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Tanggal PO <span style={{ color: "#DC2626" }}>*</span>
              </label>
              <input
                id="po-date"
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid #D1D5DB",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "13px",
                  color: "#191C1E",
                  outline: "none",
                }}
              />
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            style={{ display: "none" }}
            onChange={(e) => {
              handlePick(e.target.files?.[0])
              e.target.value = ""
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: "100%",
              padding: "32px 16px",
              borderRadius: "12px",
              border: "2px dashed #D1D5DB",
              background: "#F9FAFB",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#630ED4"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 700, fontSize: "14px", color: "#191C1E" }}>
                Klik untuk pilih berkas
              </div>
              <div style={{ marginTop: "4px", fontSize: "12px", color: "#64748B" }}>
                PDF, DOC, JPG, PNG • maks 10 MB
                {hasExistingFile ? " • opsional, ganti berkas" : ""}
              </div>
            </div>
          </button>

          {file && (
            <div
              style={{
                marginTop: "16px",
                padding: "12px 16px",
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#047857"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 600,
                    fontSize: "13px",
                    color: "#065F46",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {file.name}
                </div>
                <div
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: "11px",
                    color: "#047857",
                  }}
                >
                  {formattedSize}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label="Hapus berkas"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#047857",
                  padding: "4px",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px 14px",
                borderLeft: "4px solid #DC2626",
                background: "#FEF2F2",
                borderRadius: "8px",
                fontFamily: "'Inter', sans-serif",
                fontSize: "12px",
                color: "#7F1D1D",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="ca-footer" style={{ padding: "16px 24px" }}>
          <button type="button" className="ca-btn-cancel" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="ca-btn-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "default",
              background: canSubmit ? undefined : "#CBD5E1",
            }}
          >
            {hasExistingFile ? "Simpan" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  )
}
