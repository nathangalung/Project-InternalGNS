import { getPageNumbers } from "@/lib/pagination"
import { ui } from "@/lib/ui"
import RowsPerPageMenu from "./RowsPerPageMenu"

type PaginationProps = {
  totalItems: number
  startIndex: number
  itemsPerPage: number
  currentPage: number
  totalPages: number
  resourceLabel: string
  rowsPerPageOptions?: number[]
  onItemsPerPage: (n: number) => void
  onPage: (n: number) => void
  // Hides range while loading
  isLoading?: boolean
}

const pageBtnBase = `flex h-8 w-8 items-center justify-center rounded-sm text-sm transition ${ui.focusRing}`
const navBtn = `flex items-center justify-center rounded-sm border border-[#CCC3D8] p-2 transition hover:bg-dark-100 disabled:cursor-not-allowed ${ui.focusRing}`

// Pagination footer with page picker.
export default function Pagination({
  totalItems,
  startIndex,
  itemsPerPage,
  currentPage,
  totalPages,
  resourceLabel,
  rowsPerPageOptions = [5, 10, 15],
  onItemsPerPage,
  onPage,
  isLoading = false,
}: PaginationProps) {
  return (
    <div className="flex flex-col items-center gap-4 border-t border-dark-200 p-6 sm:flex-row sm:justify-between sm:gap-0">
      <div className="flex items-center gap-3">
        <RowsPerPageMenu
          value={itemsPerPage}
          options={rowsPerPageOptions}
          onChange={onItemsPerPage}
          triggerClassName={`flex items-center justify-between gap-2 rounded-sm border border-dark-200 bg-white px-3 py-1.5 text-sm leading-6 text-[#4A4455] ${ui.focusRing}`}
        />
        {isLoading ? (
          <span
            aria-hidden="true"
            className="h-4 w-40 rounded-sm bg-dark-100 motion-safe:animate-pulse"
          />
        ) : (
          <span className="text-sm text-[#4A4455]">
            Menampilkan {totalItems === 0 ? 0 : startIndex + 1}-
            {Math.min(startIndex + itemsPerPage, totalItems)} dari {totalItems} {resourceLabel}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1 sm:flex-nowrap sm:justify-start">
        <button
          type="button"
          className={navBtn}
          onClick={() => onPage(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          aria-label="Halaman sebelumnya"
        >
          <svg width="5" height="8" viewBox="0 0 5 8" fill="none" aria-hidden="true">
            <path
              d="M4 1L1 4L4 7"
              stroke="#191C1E"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {getPageNumbers(currentPage, totalPages).map((n, i) =>
          n === null ? (
            <span
              key={`e${i}`}
              className="select-none self-center px-[2px] text-[13px] text-[#9CA3AF]"
            >
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
          className={navBtn}
          onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages || totalPages === 0}
          aria-label="Halaman berikutnya"
        >
          <svg width="5" height="8" viewBox="0 0 5 8" fill="none" aria-hidden="true">
            <path
              d="M1 1L4 4L1 7"
              stroke="#191C1E"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
