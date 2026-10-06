import { useRef, useState } from "react"
import Modal from "@/components/shared/Modal"
import { errorMessage } from "@/lib/errors"
import { ui } from "@/lib/ui"
import { validateAsset } from "@/lib/upload-validation"
import {
  PO_NUMBER_REQUIRED_MESSAGE,
  type PoDetailsErrors,
  poNumberRequired,
  poRef,
  uploadRules,
} from "./PurchaseOrderDetail/helpers"
import type { PoRow } from "./types"

// Mirrors the poDoc upload policy.
const PO_DOC_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls"

type UploadPoModalProps = {
  row: PoRow
  hasExistingFile?: boolean
  // Saving; blocks a double submit
  submitting?: boolean
  // Filed invoice freezes number and date
  detailsLocked?: boolean
  // Invoice lookup in flight; fields wait
  checking?: boolean
  onClose: () => void
  // Resolves to the details refusal, null once saved
  onSubmit: (
    file: File | null,
    details: { poNumber: string; poDate: string },
  ) => Promise<PoDetailsErrors | null>
}

export default function UploadPoModal({
  row,
  hasExistingFile = false,
  submitting = false,
  detailsLocked = false,
  checking = false,
  onClose,
  onSubmit,
}: UploadPoModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string>("")
  const [numberError, setNumberError] = useState<string>("")
  const [dateError, setDateError] = useState<string>("")
  const [draftNumber, setDraftNumber] = useState(row.poNumber ?? "")
  const [draftDate, setDraftDate] = useState(row.poDate.slice(0, 10))
  const fileInputRef = useRef<HTMLInputElement>(null)

  const rules = uploadRules(row.status, hasExistingFile, detailsLocked)
  const detailsFrozen = detailsLocked || checking
  // Work in progress keeps its number.
  const numberRequired = poNumberRequired(row.status)
  const showNumberHint = !detailsLocked && !numberRequired
  // A locked form shows and sends the stored values.
  const poNumber = detailsLocked ? (row.poNumber ?? "") : draftNumber
  const poDate = detailsLocked ? row.poDate.slice(0, 10) : draftDate
  const isEdit = hasExistingFile || rules.fileLocked

  const formattedSize = file
    ? file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(file.size / 1024).toFixed(0)} KB`
    : ""

  function handlePick(f: File | undefined) {
    if (!f) return
    try {
      validateAsset("poDoc", f)
    } catch (err) {
      setError(errorMessage(err, "Berkas PO tidak valid."))
      return
    }
    setError("")
    setFile(f)
  }

  const canSubmit =
    !submitting &&
    !checking &&
    rules.editable &&
    (!rules.needsFile || file !== null) &&
    poDate !== ""

  async function handleSubmit() {
    if (rules.needsFile && !file) {
      setError("Berkas PO wajib diunggah.")
      return
    }
    if (numberRequired && !poNumber.trim()) {
      setNumberError(PO_NUMBER_REQUIRED_MESSAGE)
      return
    }
    if (!poDate) {
      setError("Tanggal PO wajib diisi.")
      return
    }
    setError("")
    setNumberError("")
    setDateError("")
    const refused = await onSubmit(file, { poNumber: poNumber.trim(), poDate })
    if (!refused) return
    setNumberError(refused.fields.poNumber ?? "")
    setDateError(refused.fields.poDate ?? "")
    setError(refused.banner ?? "")
  }

  return (
    <Modal
      onClose={onClose}
      title={
        <>
          <span className="block">
            {isEdit ? "Ubah Detail Purchase Order" : "Unggah Berkas PO"}
          </span>
          <span className="mt-1 block text-[13px] font-normal leading-6 text-[#4A4455]">
            {poRef(row)} • {row.client}
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
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
          >
            {submitting ? "Menyimpan..." : isEdit ? "Simpan" : "Upload"}
          </button>
        </>
      }
    >
      <div className={ui.modalSection}>
        <div className={ui.field}>
          <label htmlFor="po-number" className={ui.fieldLabel}>
            Nomor PO {numberRequired && <span className="text-[#DC2626]">*</span>}
          </label>
          <input
            id="po-number"
            type="text"
            value={poNumber}
            maxLength={50}
            onChange={(e) => {
              setDraftNumber(e.target.value)
              setNumberError("")
            }}
            disabled={detailsFrozen}
            aria-invalid={numberError !== "" || undefined}
            aria-describedby={
              detailsLocked
                ? "po-details-locked"
                : numberError
                  ? "po-number-error"
                  : showNumberHint
                    ? "po-number-hint"
                    : undefined
            }
            className={`${ui.fieldInput} ${ui.disabledField}`}
          />
          {numberError ? (
            <p id="po-number-error" role="alert" className="m-0 mt-1 text-xs text-[#B91C1C]">
              {numberError}
            </p>
          ) : (
            showNumberHint && (
              <p id="po-number-hint" className="m-0 mt-1 text-xs text-[#4A4455]">
                Nomor PO dari klien, wajib diisi sebelum PO Dalam Progres.
              </p>
            )
          )}
        </div>
        <div className={ui.field}>
          <label htmlFor="po-date" className={ui.fieldLabel}>
            Tanggal PO <span className="text-[#DC2626]">*</span>
          </label>
          <input
            id="po-date"
            type="date"
            value={poDate}
            onChange={(e) => {
              setDraftDate(e.target.value)
              setDateError("")
            }}
            disabled={detailsFrozen}
            aria-invalid={dateError !== "" || undefined}
            aria-describedby={
              detailsLocked ? "po-details-locked" : dateError ? "po-date-error" : undefined
            }
            className={`${ui.fieldInput} ${ui.disabledField}`}
          />
          {dateError && (
            <p id="po-date-error" role="alert" className="m-0 mt-1 text-xs text-[#B91C1C]">
              {dateError}
            </p>
          )}
        </div>
        {detailsLocked && (
          <p id="po-details-locked" className="text-xs text-[#4A4455]">
            Nomor dan tanggal PO tidak dapat diubah karena invoice sudah dikirim.
          </p>
        )}
      </div>

      <div>
        {rules.fileLocked ? (
          <p className="m-0 rounded-md bg-[#F9FAFB] px-4 py-3 text-xs text-[#4A4455]">
            Berkas PO tidak dapat diganti setelah PO dikirim atau dibatalkan.
          </p>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={PO_DOC_ACCEPT}
              className="hidden"
              onChange={(e) => {
                handlePick(e.target.files?.[0])
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`${ui.focusRing} flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-4 py-8`}
            >
              <svg
                aria-hidden="true"
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
                  PDF, PNG, JPG, WEBP, XLS, XLSX • maks 20 MB
                  {hasExistingFile ? " • opsional, ganti berkas" : ""}
                </div>
              </div>
            </button>

            {file && (
              <div className="mt-4 flex items-center gap-3 rounded-[10px] border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3">
                <svg
                  aria-hidden="true"
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
                  aria-label="Batalkan pilihan berkas"
                  className={`rounded-sm p-1 text-[#047857] ${ui.focusRing}`}
                >
                  <svg
                    aria-hidden="true"
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
          </>
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
