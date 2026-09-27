import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"
import { dropdown, field } from "@/lib/ui"
import { cn, type WithClassName } from "@/lib/utils"

// Autocomplete primitives, free-text suggestions.
//
// For fields whose value is the typed text, with catalog rows offered as
// shortcuts (the request, offer and vendor fields of a quotation line).
// Same field input, dropdown panel and rows as the combobox; rows carry no
// selected state, so callers mark the matching row themselves.

const Autocomplete = AutocompletePrimitive.Root
const AutocompleteList = AutocompletePrimitive.List
const AutocompleteGroup = AutocompletePrimitive.Group
const AutocompleteEmpty = AutocompletePrimitive.Empty
const AutocompleteStatus = AutocompletePrimitive.Status

function AutocompleteInput({
  className,
  ...props
}: WithClassName<AutocompletePrimitive.Input.Props>) {
  return (
    <AutocompletePrimitive.Input
      data-slot="autocomplete-input"
      className={cn(field().input(), "placeholder:text-dark-500", className)}
      {...props}
    />
  )
}

type PositionProps = Pick<
  AutocompletePrimitive.Positioner.Props,
  "align" | "alignOffset" | "side" | "sideOffset" | "collisionAvoidance"
>

// Panel stays under its field.
const stayBelow = { side: "none" } as const

function AutocompleteContent({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  collisionAvoidance = stayBelow,
  ...props
}: WithClassName<AutocompletePrimitive.Popup.Props> & PositionProps) {
  return (
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionAvoidance={collisionAvoidance}
        className="z-[110]"
      >
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-content"
          className={cn(
            dropdown({ placement: "floating" }).panel(),
            "max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto outline-none",
            className,
          )}
          {...props}
        />
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  )
}

// Suggestion row, highlight on hover.
function AutocompleteItem({
  className,
  ...props
}: WithClassName<AutocompletePrimitive.Item.Props>) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(dropdown().item(), "outline-none data-highlighted:bg-dark-100", className)}
      {...props}
    />
  )
}

// Catalog-style group heading.
function AutocompleteGroupLabel({
  className,
  ...props
}: WithClassName<AutocompletePrimitive.GroupLabel.Props>) {
  return (
    <AutocompletePrimitive.GroupLabel
      data-slot="autocomplete-label"
      className={cn(
        "px-5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.6px] text-[#9CA3AF]",
        className,
      )}
      {...props}
    />
  )
}

export {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteStatus,
}
