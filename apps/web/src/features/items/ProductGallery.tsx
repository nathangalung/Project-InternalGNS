import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import Modal from "@/components/shared/Modal"
import { clampSlide, nearSlides, slideFromScroll } from "@/features/items/gallery"
import { useDeleteItemImage, useItemGallery, useSetItemCover } from "@/features/items/hooks"
import { useObjectUrl } from "@/hooks/useObjectUrl"
import { btnRemove, ui } from "@/lib/ui"
import type { ItemImage } from "@/types/api"

type ProductGalleryProps = {
  product: { id: number; name: string }
  canWrite: boolean
}

const smallOutline = `${ui.btnOutline} px-3 py-1.5 text-xs`
const navBtn = `absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-dark-800 shadow-md transition hover:bg-white disabled:opacity-0 ${ui.focusRing}`

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
}

// Product photo slider.
//
// A swipeable strip of the product's photos, cover first: touch swipe,
// arrow buttons, dots and the arrow keys all move it. Photos load as they
// come near, and stay once loaded. A catalog writer makes the shown photo
// the cover or removes it; removal asks first. Hidden while there are none.
export default function ProductGallery({ product, canWrite }: ProductGalleryProps) {
  const { data } = useItemGallery(product.id)
  const images = data?.images ?? []
  const count = images.length
  const stripRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set())
  const [viewing, setViewing] = useState("")
  const [confirming, setConfirming] = useState(false)
  const cover = useSetItemCover()
  const remove = useDeleteItemImage()

  const shown = clampSlide(current, count)
  const image = images[shown]

  // Photos near the shown one load, and stay loaded.
  useEffect(() => {
    const near = [...nearSlides(shown, count)].flatMap((i) => (images[i] ? [images[i].id] : []))
    setSeen((prev) => (near.every((id) => prev.has(id)) ? prev : new Set([...prev, ...near])))
  }, [shown, count, images])

  // A removal can leave the strip past its end.
  // Only on a count change, so it never fights a swipe in progress.
  const lastCount = useRef(count)
  useEffect(() => {
    if (lastCount.current === count) return
    lastCount.current = count
    const strip = stripRef.current
    if (strip) strip.scrollLeft = shown * strip.clientWidth
  }, [count, shown])

  if (count === 0) return null

  function goTo(index: number) {
    const next = clampSlide(index, count)
    setCurrent(next)
    stripRef.current?.scrollTo({
      left: next * (stripRef.current?.clientWidth ?? 0),
      behavior: reducedMotion() ? "auto" : "smooth",
    })
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight") goTo(shown + 1)
    else if (e.key === "ArrowLeft") goTo(shown - 1)
    else return
    e.preventDefault()
  }

  function confirmRemove() {
    if (!image) return
    remove.mutate({ id: product.id, imageId: image.id }, { onSuccess: () => setConfirming(false) })
  }

  const busy = cover.isPending || remove.isPending

  return (
    <section
      aria-labelledby={`galeri-${product.id}`}
      className="flex flex-col gap-3 rounded-lg bg-white px-6 py-5 max-sm:px-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={`galeri-${product.id}`} className="text-base font-bold text-[#191C1E]">
          Foto Produk
        </h2>
        <span className="text-xs font-semibold text-dark-600" aria-live="polite">
          {shown + 1} / {count}
        </span>
      </div>

      {/* Arrow keys work from any focused control inside. */}
      <section
        aria-roledescription="carousel"
        aria-label={`Foto ${product.name}`}
        onKeyDown={onKey}
        className="relative rounded-md"
      >
        <div
          ref={stripRef}
          onScroll={(e) =>
            setCurrent(
              slideFromScroll(e.currentTarget.scrollLeft, e.currentTarget.clientWidth, count),
            )
          }
          className="flex snap-x snap-mandatory overflow-x-auto rounded-md bg-dark-50 [scrollbar-width:none]"
        >
          {images.map((img, i) => (
            <Slide
              key={img.id}
              image={img}
              load={seen.has(img.id)}
              label={`Foto ${i + 1} dari ${count}`}
              name={product.name}
              onOpen={setViewing}
            />
          ))}
        </div>
        {count > 1 && (
          <>
            <button
              type="button"
              className={`${navBtn} left-2`}
              onClick={() => goTo(shown - 1)}
              disabled={shown === 0}
              aria-label="Foto sebelumnya"
            >
              <Chevron flip />
            </button>
            <button
              type="button"
              className={`${navBtn} right-2`}
              onClick={() => goTo(shown + 1)}
              disabled={shown === count - 1}
              aria-label="Foto berikutnya"
            >
              <Chevron />
            </button>
          </>
        )}
      </section>

      {count > 1 && (
        <div className="flex justify-center gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Foto ${i + 1}`}
              aria-current={i === shown ? "true" : undefined}
              className={`h-2.5 rounded-full transition-all ${
                i === shown ? "w-6 bg-primary-700" : "w-2.5 bg-dark-300 hover:bg-dark-400"
              } ${ui.focusRing}`}
            />
          ))}
        </div>
      )}

      {canWrite && image && (
        <div className="flex flex-wrap items-center gap-2">
          {image.isCover ? (
            <span className="rounded-[4px] bg-primary-50 px-2 py-1 text-xs font-semibold text-primary-700">
              Foto Utama
            </span>
          ) : (
            <button
              type="button"
              className={smallOutline}
              disabled={busy}
              onClick={() => cover.mutate({ id: product.id, imageId: image.id })}
            >
              {cover.isPending ? "Menyimpan..." : "Jadikan Foto Utama"}
            </button>
          )}
          <button
            type="button"
            className={`${btnRemove} px-3 py-1.5 text-xs`}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Hapus Foto
          </button>
        </div>
      )}

      {viewing && (
        <Modal title={product.name} onClose={() => setViewing("")}>
          <img
            src={viewing}
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
            {image?.isCover
              ? `Foto utama ${product.name} akan dihapus; foto berikutnya menjadi foto utama.`
              : `Foto ini akan dihapus dari galeri ${product.name}.`}
          </p>
        </Modal>
      )}
    </section>
  )
}

type SlideProps = {
  image: ItemImage
  load: boolean
  label: string
  name: string
  onOpen: (url: string) => void
}

// One photo of the strip.
// Its height is fixed, so nothing shifts while the photo loads.
function Slide({ image, load, label, name, onOpen }: SlideProps) {
  const url = useObjectUrl(load ? image.downloadUrl : undefined)
  return (
    <figure
      aria-roledescription="slide"
      aria-label={label}
      className="relative m-0 flex h-[260px] w-full flex-none snap-center items-center justify-center sm:h-[360px]"
    >
      {url ? (
        <button
          type="button"
          onClick={() => onOpen(url)}
          aria-label={`Lihat ${label.toLowerCase()} ukuran penuh`}
          className={`h-full w-full p-0 ${ui.focusRing}`}
        >
          <img src={url} alt={`${label} ${name}`} className="h-full w-full object-contain" />
        </button>
      ) : (
        <span className="text-xs text-dark-500">Memuat foto…</span>
      )}
      {image.isCover && (
        <span className="absolute left-3 top-3 rounded-[4px] bg-white/90 px-2 py-0.5 text-[11px] font-bold text-primary-700">
          Utama
        </span>
      )}
    </figure>
  )
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={flip ? "rotate-180" : undefined}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
