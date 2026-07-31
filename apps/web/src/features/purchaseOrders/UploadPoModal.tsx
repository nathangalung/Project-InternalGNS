import { useEffect, useRef, useState } from "react"
import Modal from "@/components/shared/Modal"
import { ui } from "@/lib/ui"
import type { PoRow } from "./types"

interface UploadPoModalProps {
  row: PoRow
  hasExistingFile?: boolean
  onClose: () => void
  onSubmit: (file: File | null, details: { poNumber: string; poDate: string }) => void
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
    <Modal
      onClose={onClose}
      title={
        <>
          <span className="block">
            {hasExistingFile ? "Ubah Detail Purchase Order" : "Upload Berkas Purchase Order"}
          </span>
          <span className="mt-1 block text-[13px] font-normal leading-6 text-[#4A4455]">
            {row.poNumber} • {row.client}
          </span>
        </>
      }
      footer={
        <>
          <button type="button" className={ui.modalCancel} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className={ui.modalSubmit}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {hasExistingFile ? "Simpan" : "Upload"}
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.field}>
          <label htmlFor="po-number" className={ui.fieldLabel}>
            Nomor PO <span className="text-[#DC2626]">*</span>
          </label>
          <input
            id="po-number"
            type="text"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            className={ui.fieldInput}
          />
        </div>
        <div className={ui.field}>
          <label htmlFor="po-date" className={ui.fieldLabel}>
            Tanggal PO <span className="text-[#DC2626]">*</span>
          </label>
          <input
            id="po-date"
            type="date"
            value={poDate}
            onChange={(e) => setPoDate(e.target.value)}
            className={ui.fieldInput}
          />
        </div>
      </div>

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            handlePick(e.target.files?.[0])
            e.target.value = ""
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-4 py-8"
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
          <div className="text-center">
            <div className="text-sm font-bold text-[#191C1E]">Klik untuk pilih berkas</div>
            <div className="mt-1 text-xs text-dark-500">
              PDF, DOC, JPG, PNG • maks 10 MB
              {hasExistingFile ? " • opsional, ganti berkas" : ""}
            </div>
          </div>
        </button>

        {file && (
          <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3">
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
            <div className="min-w-0 flex-1">
              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-[#065F46]">
                {file.name}
              </div>
              <div className="text-[11px] text-[#047857]">{formattedSize}</div>
            </div>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Hapus berkas"
              className="p-1 text-[#047857]"
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
          <div className="mt-3 rounded-md border-l-4 border-l-[#DC2626] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#7F1D1D]">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
