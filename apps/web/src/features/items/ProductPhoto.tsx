import { type ReactNode, useEffect, useRef, useState } from "react"
import Modal from "@/components/shared/Modal"
import { productInitials } from "@/features/items/helpers"
import { useItemImage, useRemoveItemImage, useUploadItemImage } from "@/features/items/hooks"
import { logoBackground } from "@/lib/avatar"
import { btnRemove, ui } from "@/lib/ui"

type ProductPhotoProps = {
  product: { id: number; name: string; imageObjectKey?: string }
  canWrite: boolean
  // Name block beside the photo
  children: ReactNode
}

// Accepted photo types.
const PHOTO_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif"

const smallOutline = `${ui.btnOutline} px-3 py-1.5 text-xs`

// Product photo with its actions.
//
// Anyone can open the photo full size. A catalog writer adds, replaces or
// removes it; removal asks first. The picked file shows at once from a
// local blob URL and stays until the next pick or a removal, so the photo
// never flickers back to the old one while the server copy loads. A failed
// upload drops the local copy again.
export default function ProductPhoto({ product, canWrite, children }: ProductPhotoProps) {
  const stored = useItemImage(product.id, product.imageObjectKey)
  const upload = useUploadItemImage()
  const remove = useRemoveItemImage()
  const inputRef = useRef<HTMLInputElement>(null)
  const pickRef = useRef<HTMLButtonElement>(null)
  const [local, setLocal] = useState("")
  const [viewing, setViewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [refocus, setRefocus] = useState(false)

  // Revoke a replaced local copy.
  useEffect(() => {
    if (!local) return
    return () => URL.revokeObjectURL(local)
  }, [local])

  // Focus survives a removal.
  // The Hapus Foto button that opened the dialog is gone once the photo is,
  // so focus moves to the add button after the dialog has let go.
  useEffect(() => {
    if (!refocus || confirming) return
    pickRef.current?.focus()
    setRefocus(false)
  }, [refocus, confirming])

  const photo = local || (product.imageObjectKey ? stored : "")
  const hasPhoto = Boolean(product.imageObjectKey) || Boolean(local)
  const busy = upload.isPending || remove.isPending

  function pick(file: File | undefined) {
    if (!file) return
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : ""
    setLocal(preview)
    upload.mutate({ id: product.id, file }, { onError: () => setLocal("") })
  }

  function confirmRemove() {
    remove.mutate(product.id, {
      onSuccess: () => {
        setLocal("")
        setConfirming(false)
        setRefocus(true)
      },
    })
  }

  const frame =
    "flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg text-2xl font-extrabold tracking-[0.5px] text-white"
  const face = photo ? (
    <img src={photo} alt="" className="h-full w-full bg-white object-cover" />
  ) : (
    <span aria-hidden="true">{productInitials(product.name)}</span>
  )
  const frameStyle = { background: photo ? "#FFFFFF" : logoBackground(product.name) }

  return (
    <>
      {photo ? (
        <button
          type="button"
          onClick={() => setViewing(true)}
          aria-label={`Lihat foto ${product.name}`}
          aria-busy={upload.isPending}
          className={`${frame} p-0 ${upload.isPending ? "opacity-70" : ""} ${ui.focusRing}`}
          style={frameStyle}
        >
          {face}
        </button>
      ) : (
        <div className={frame} style={frameStyle}>
          {face}
        </div>
      )}

      <div className="min-w-0 flex-1 max-sm:basis-[160px]">
        {children}
        {canWrite && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={PHOTO_ACCEPT}
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0])
                e.target.value = ""
              }}
            />
            <button
              ref={pickRef}
              type="button"
              className={smallOutline}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              {upload.isPending ? "Mengunggah..." : hasPhoto ? "Ganti Foto" : "Tambah Foto"}
            </button>
            {hasPhoto && (
              <button
                type="button"
                className={`${btnRemove} px-3 py-1.5 text-xs`}
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                Hapus Foto
              </button>
            )}
          </div>
        )}
      </div>

      {viewing && photo && (
        <Modal title={product.name} onClose={() => setViewing(false)}>
          <img
            src={photo}
            alt={`Foto ${product.name}`}
            className="mx-auto mb-4 max-h-[70vh] w-auto max-w-full rounded-md object-contain"
          />
        </Modal>
      )}

      {confirming && (
        <Modal
          title="Hapus foto produk?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button type="button" className={ui.modalCancel} onClick={() => setConfirming(false)}>
                Batal
              </button>
              <button
                type="button"
                className={ui.modalSubmit}
                disabled={remove.isPending}
                onClick={confirmRemove}
              >
                {remove.isPending ? "Menghapus..." : "Hapus Foto"}
              </button>
            </>
          }
        >
          <p className="m-0 pb-4 text-sm text-[#4A4455]">
            Foto {product.name} akan dihapus dari katalog. Produk kembali ditampilkan dengan
            inisialnya.
          </p>
        </Modal>
      )}
    </>
  )
}
