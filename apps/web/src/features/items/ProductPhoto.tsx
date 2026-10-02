import { type ReactNode, useRef, useState } from "react"
import Modal from "@/components/shared/Modal"
import { filesToAdd } from "@/features/items/gallery"
import { productInitials } from "@/features/items/helpers"
import { useAddItemImages, useItemGallery, useItemImage } from "@/features/items/hooks"
import { logoBackground } from "@/lib/avatar"
import { toast } from "@/lib/toast"
import { ui } from "@/lib/ui"

type ProductPhotoProps = {
  product: { id: number; name: string; imageObjectKey?: string }
  canWrite: boolean
  // Name block beside the photo
  children: ReactNode
}

// Accepted photo types.
const PHOTO_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif"

const smallOutline = `${ui.btnOutline} px-3 py-1.5 text-xs`

// Product cover with the add action.
//
// The cover (Foto Utama) is the product's avatar; anyone can open it full
// size. A catalog writer adds photos to the gallery below, several at once,
// up to its maximum; picks past the maximum are left out with a notice.
export default function ProductPhoto({ product, canWrite, children }: ProductPhotoProps) {
  const photo = useItemImage(product.id, product.imageObjectKey)
  const { data: gallery } = useItemGallery(canWrite ? product.id : undefined)
  const add = useAddItemImages()
  const inputRef = useRef<HTMLInputElement>(null)
  const [viewing, setViewing] = useState(false)

  const have = gallery?.images.length ?? 0
  const max = gallery?.max ?? 0
  const full = gallery !== undefined && have >= max

  function pick(files: File[]) {
    if (files.length === 0) return
    const { take, skipped } = filesToAdd(files, have, max)
    if (skipped > 0)
      toast.info(`Maksimal ${max} foto per produk; ${skipped} foto tidak ditambahkan.`)
    if (take.length > 0) add.mutate({ id: product.id, files: take })
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
          className={`${frame} p-0 ${ui.focusRing}`}
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
              multiple
              className="hidden"
              onChange={(e) => {
                pick([...(e.target.files ?? [])])
                e.target.value = ""
              }}
            />
            <button
              type="button"
              className={smallOutline}
              disabled={add.isPending || full || gallery === undefined}
              aria-busy={add.isPending}
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
              {add.isPending ? "Mengunggah..." : `Tambah Foto (${have}/${max})`}
            </button>
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
    </>
  )
}
