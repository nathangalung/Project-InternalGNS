import { useId, useState } from "react"
import Modal from "@/components/shared/Modal"
import { storeLinkBody, storeLinkError } from "@/features/items/helpers"
import { useAddVendorToItem } from "@/features/items/hooks"
import { storeUrlError } from "@/lib/store-link"
import { ui } from "@/lib/ui"

type StoreLinkModalProps = {
  itemId: number
  vendorId: number
  vendorName: string
  // Stored link, absent when none
  current?: string
  onClose: () => void
}

// Store link of one vendor link.
//
// Sends only the vendor and the link, so the stored harga beli, its quote
// date and the SKU stay as they are.
export default function StoreLinkModal({
  itemId,
  vendorId,
  vendorName,
  current,
  onClose,
}: StoreLinkModalProps) {
  const [url, setUrl] = useState(current ?? "")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const save = useAddVendorToItem()
  const inputId = useId()
  const errorId = useId()

  const typedError = storeUrlError(url)
  const shownError = typedError ?? fieldError
  const body = storeLinkBody(url, current)
  const canSave = typedError === null && body !== undefined && !save.isPending

  function close() {
    if (!save.isPending) onClose()
  }

  async function handleSave() {
    if (!canSave) return
    setFieldError(null)
    setFormError(null)
    try {
      await save.mutateAsync({ itemId, input: { vendorId, productUrl: body } })
      onClose()
    } catch (err) {
      const placed = storeLinkError(err)
      setFieldError(placed.field ?? null)
      setFormError(placed.form ?? null)
    }
  }

  return (
    <Modal
      title={current ? "Ubah Link Toko" : "Tambah Link Toko"}
      onClose={close}
      className="max-w-[min(520px,92vw)]!"
      footer={
        <>
          {formError && (
            <span role="alert" className="flex-1 text-[12px] text-error">
              {formError}
            </span>
          )}
          <div className="flex gap-4 max-sm:w-full max-sm:*:flex-1 max-sm:*:px-4">
            <button
              type="button"
              className={ui.modalCancel}
              onClick={close}
              disabled={save.isPending}
            >
              Batal
            </button>
            <button
              type="button"
              className={ui.modalSubmit}
              onClick={() => void handleSave()}
              disabled={!canSave}
            >
              {save.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </>
      }
    >
      <div className={ui.modalSection}>
        <p className="m-0 text-sm text-dark-600">
          Vendor <strong className="text-dark-900">{vendorName}</strong>. Harga beli vendor ini
          tidak berubah.
        </p>
        <div className={ui.field}>
          <label htmlFor={inputId} className={ui.fieldLabel}>
            Link Toko
          </label>
          <input
            id={inputId}
            className={`${ui.fieldInput} font-sans ${shownError ? "border-error" : ""}`}
            type="url"
            placeholder="https://toko.com/produk/..."
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setFieldError(null)
            }}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? errorId : undefined}
          />
          {shownError && (
            <p id={errorId} className="text-[12px] text-error">
              {shownError}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
