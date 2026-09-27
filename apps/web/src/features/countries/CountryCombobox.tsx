import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { useState } from "react"
import { messageCls } from "@/components/shared/SearchCombobox"
import { Combobox, ComboboxContent, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { useCountries } from "@/features/countries/hooks"
import { ui } from "@/lib/ui"
import type { CountryRow } from "@/types/api"
import { matchCountries } from "./match"

type CountryComboboxProps = {
  // Picked ISO code, "" for none
  code: string
  onCodeChange: (code: string) => void
  triggerId: string
  triggerClassName: string
  // Trigger text when nothing matches
  fallback: string
  panelClassName?: string
  chevronColor?: string
  disabled?: boolean
}

// Country code picker, searchable.
//
// A select-style trigger that opens the dropdown panel with a search field
// on top (Base UI's input-inside-popup combobox), listing "IDN - Indonesia"
// rows, five at a time, matched on name or code.
export default function CountryCombobox({
  code,
  onCodeChange,
  triggerId,
  triggerClassName,
  fallback,
  panelClassName,
  chevronColor = "currentColor",
  disabled = false,
}: CountryComboboxProps) {
  const { data: countries } = useCountries()
  const [query, setQuery] = useState("")
  const all = countries ?? []
  const value = all.find((c) => c.code === code) ?? null
  const label = (c: CountryRow) => `${c.code} - ${c.name}`

  return (
    <Combobox<CountryRow>
      items={matchCountries(all, query)}
      filter={null}
      value={value}
      inputValue={query}
      disabled={disabled}
      itemToStringLabel={label}
      isItemEqualToValue={(a, b) => a.code === b.code}
      onInputValueChange={setQuery}
      onValueChange={(c) => {
        if (c) onCodeChange(c.code)
      }}
    >
      <ComboboxPrimitive.Trigger id={triggerId} className={triggerClassName}>
        <span>{value ? label(value) : fallback}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={chevronColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </ComboboxPrimitive.Trigger>
      <ComboboxContent className={panelClassName}>
        <div className="px-3 pb-2">
          <ComboboxPrimitive.Input
            placeholder="Cari negara..."
            aria-label="Cari negara"
            className={`w-full rounded-sm border border-[rgba(204,195,216,0.4)] bg-[#F7F7F8] px-3 py-2 font-sans text-[13px] text-[#191C1E] outline-none transition ${ui.fieldFocus}`}
          />
        </div>
        <ComboboxPrimitive.Empty>
          <div className={`${messageCls} font-sans`}>Tidak ada hasil</div>
        </ComboboxPrimitive.Empty>
        <ComboboxList>
          {(c: CountryRow) => (
            <ComboboxItem key={c.code} value={c}>
              {label(c)}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
