import Modal from "@/components/shared/Modal"
import { useObjectUrlState } from "@/hooks/useObjectUrl"
import { ui } from "@/lib/ui"
import { usePoFileUrl } from "../hooks"
import { previewKind } from "./helpers"

type FilePreviewModalProps = {
  poId: number
  objectKey: string
  fileName: string
  onDownload: () => void
  onClose: () => void
}

const frame = "h-[70vh] w-full rounded-md border border-dark-200 bg-dark-100"

// PO file, shown inline.
//
// The file comes through the authenticated proxy as a blob URL, which the
// enforced CSP allows as an image and as a frame. Closing unmounts the
// modal, which revokes the URL. A spreadsheet is never fetched here.
export default function FilePreviewModal({
  poId,
  objectKey,
  fileName,
  onDownload,
  onClose,
}: FilePreviewModalProps) {
  const kind = previewKind(fileName)
  const address = usePoFileUrl(poId, kind === "none" ? undefined : objectKey)
  const { url, failed } = useObjectUrlState(address.data?.downloadUrl)
  const loadFailed = failed || address.isError

  function body() {
    if (kind === "none") {
      return (
        <p className="m-0 text-sm text-dark-600">
          Pratinjau tidak tersedia untuk berkas ini. Unduh berkas untuk membukanya.
        </p>
      )
    }
    if (loadFailed) {
      return (
        <p role="alert" className="m-0 text-sm text-error">
          Gagal memuat berkas PO. Unduh berkas untuk membukanya.
        </p>
      )
    }
    if (!url) return <p className="m-0 text-sm text-dark-500">Memuat berkas...</p>
    if (kind === "image") {
      return (
        <img src={url} alt={fileName} className="mx-auto max-h-[70vh] max-w-full object-contain" />
      )
    }
    return <iframe src={url} title={fileName} className={frame} />
  }

  return (
    <Modal
      title="Pratinjau Berkas PO"
      onClose={onClose}
      className="w-[min(1040px,94vw)] max-w-[94vw]"
      footer={
        <>
          <span className="min-w-0 flex-1 truncate text-sm text-dark-600" title={fileName}>
            {fileName}
          </span>
          <div className="flex flex-wrap gap-3 max-sm:w-full max-sm:*:flex-1">
            {kind === "pdf" && (
              <button
                type="button"
                className={ui.btnOutline}
                disabled={!url}
                onClick={() => window.open(url, "_blank", "noopener")}
              >
                Buka di Tab Baru
              </button>
            )}
            <button type="button" className={ui.btnPrimary} onClick={onDownload}>
              Unduh Berkas
            </button>
          </div>
        </>
      }
    >
      <div className="pb-2">{body()}</div>
    </Modal>
  )
}
