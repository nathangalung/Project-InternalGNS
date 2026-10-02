import { getPageNumbers } from "@/lib/pagination"
import { ui } from "@/lib/ui"

type PageButtonsProps = {
  currentPage: number
  totalPages: number
  onPage: (n: number) => void
  // Wrapper layout classes
  className?: string
  // Fades the disabled arrows
  dimDisabled?: boolean
}

const pageBtnBase = `flex h-8 w-8 items-center justify-center rounded-sm text-sm transition ${ui.focusRing}`
const navBtn = `flex items-center justify-center rounded-sm border border-[#CCC3D8] p-2 transition hover:bg-dark-100 disabled:cursor-not-allowed ${ui.focusRing}`

function Chevron({ d }: { d: string }) {
  return (
    <svg width="5" height="8" viewBox="0 0 5 8" fill="none" aria-hidden="true">
      <path d={d} stroke="#191C1E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Previous, numbers, next.
//
// The page picker every paged table shares; the caller passes a page
// already within 1..totalPages.
export default function PageButtons({
  currentPage,
  totalPages,
  onPage,
  className = "flex items-center gap-1",
  dimDisabled = false,
}: PageButtonsProps) {
  const nav = dimDisabled ? `${navBtn} disabled:opacity-40` : navBtn
  return (
    <div className={className}>
      <button
        type="button"
        className={nav}
        onClick={() => onPage(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        aria-label="Halaman sebelumnya"
      >
        <Chevron d="M4 1L1 4L4 7" />
      </button>
      {getPageNumbers(currentPage, totalPages).map((n, i) =>
        n === null ? (
          <span key={`e${i}`} className="select-none self-center px-0.5 text-[13px] text-[#9CA3AF]">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === currentPage ? "page" : undefined}
            className={`${pageBtnBase} ${
              n === currentPage
                ? "bg-primary-700 font-bold text-white"
                : "font-medium text-[#4A4455] hover:bg-dark-100"
            }`}
          >
            {n}
          </button>
        ),
      )}
      <button
        type="button"
        className={nav}
        onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        aria-label="Halaman berikutnya"
      >
        <Chevron d="M1 1L4 4L1 7" />
      </button>
    </div>
  )
}
