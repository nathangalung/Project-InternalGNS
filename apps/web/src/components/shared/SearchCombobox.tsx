import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { type ReactNode, useState } from "react"
import { Combobox, ComboboxContent, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { ui } from "@/lib/ui"

type SearchComboboxProps<T> = {
  // Matches for the query, already filtered
  items: T[]
  value: T | null
  onValueChange: (item: T | null) => void
  query: string
  onQueryChange: (query: string) => void
  itemKey: (item: T) => string | number
  // Input text once an item is picked
  itemToString: (item: T) => string
  renderItem?: (item: T) => ReactNode
  inputClassName: string
  inputId?: string
  placeholder?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  readOnly?: boolean
  // Icon inside the field, absolutely placed
  leading?: ReactNode
  // Clear button label; omit for none
  clearLabel?: string
  panelClassName?: string
  // No-match content
  empty: ReactNode
  // Loading content, announced politely
  status?: ReactNode
}

// Search picker on Base UI.
//
// The field the unit, country and vendor pickers share: the value is one of
// the listed items, typing drops it and searches again, and the list opens
// only while there is a query, as the hand-built panels did. The caller owns
// the filtering (a server search passes its hits), so Base UI's own filter is
// off. A typed query survives a blur without a pick instead of being wiped.
export default function SearchCombobox<T>({
  items,
  value,
  onValueChange,
  query,
  onQueryChange,
  itemKey,
  itemToString,
  renderItem = itemToString,
  inputClassName,
  inputId,
  placeholder,
  readOnly = false,
  leading,
  clearLabel,
  panelClassName,
  empty,
  status,
  ...aria
}: SearchComboboxProps<T>) {
  const [open, setOpen] = useState(false)
  const shown = open && !readOnly && query.length > 0

  return (
    <Combobox<T>
      items={items}
      filter={null}
      value={value}
      inputValue={query}
      open={shown}
      readOnly={readOnly}
      itemToStringLabel={itemToString}
      isItemEqualToValue={(a, b) => itemKey(a) === itemKey(b)}
      onOpenChange={(next, details) => {
        // A picked value stays closed on click.
        if (next && value !== null && details.reason === "input-press") return
        setOpen(next)
      }}
      onInputValueChange={(text, details) => {
        if (details.reason !== "input-change") return
        onQueryChange(text)
        if (value !== null) onValueChange(null)
        setOpen(true)
      }}
      onValueChange={(item) => {
        onValueChange(item)
        if (item !== null) onQueryChange(itemToString(item))
        setOpen(false)
      }}
    >
      <div className="relative">
        {leading}
        <ComboboxPrimitive.Input
          id={inputId}
          className={inputClassName}
          placeholder={placeholder}
          {...aria}
        />
        {clearLabel && !readOnly && query && (
          <button
            type="button"
            onClick={() => {
              onQueryChange("")
              onValueChange(null)
              setOpen(false)
            }}
            title="Bersihkan"
            aria-label={clearLabel}
            className={`absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center rounded-sm p-1 text-[#94A3B8] ${ui.focusRing}`}
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        )}
      </div>
      <ComboboxContent className={panelClassName}>
        <ComboboxPrimitive.Status>{status}</ComboboxPrimitive.Status>
        {!status && <ComboboxPrimitive.Empty>{empty}</ComboboxPrimitive.Empty>}
        <ComboboxList>
          {(item: T) => (
            <ComboboxItem key={itemKey(item)} value={item}>
              {renderItem(item)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

// Status and no-match row.
export const messageCls = "px-5 py-3 text-center text-[13px] text-[#94A3B8]"
