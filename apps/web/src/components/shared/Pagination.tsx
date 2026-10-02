import { ui } from "@/lib/ui"
import PageButtons from "./PageButtons"
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

      <PageButtons
        currentPage={currentPage}
        totalPages={totalPages}
        onPage={onPage}
        className="flex flex-wrap items-center justify-center gap-1 sm:flex-nowrap sm:justify-start"
      />
    </div>
  )
}
