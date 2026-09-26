import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon } from "@/components/document/icons"
import { dropdown, field } from "@/lib/ui"
import { cn, type WithClassName } from "@/lib/utils"

// Combobox primitives, search picker look.
//
// For the client, product and vendor pickers: the grey field input, the
// dropdown panel 4px below at the input's width, a catalog-style group
// label, and an empty row. For a server search, pass filter={null} and
// drive the items from onInputValueChange.

const Combobox = ComboboxPrimitive.Root
const ComboboxCollection = ComboboxPrimitive.Collection

function ComboboxInput({ className, ...props }: WithClassName<ComboboxPrimitive.Input.Props>) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(field().input(), "placeholder:text-dark-500", className)}
      {...props}
    />
  )
}

type PositionProps = Pick<
  ComboboxPrimitive.Positioner.Props,
  "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
>

function ComboboxContent({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  ...props
}: WithClassName<ComboboxPrimitive.Popup.Props> & PositionProps) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        className="z-[110]"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            dropdown({ placement: "floating" }).panel(),
            "max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto outline-none",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: WithClassName<ComboboxPrimitive.List.Props>) {
  return <ComboboxPrimitive.List data-slot="combobox-list" className={className} {...props} />
}

// Option row, bold when chosen.
function ComboboxItem({
  className,
  children,
  ...props
}: WithClassName<ComboboxPrimitive.Item.Props>) {
  const dd = dropdown()
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(dd.item(), "group outline-none data-highlighted:bg-dark-100", className)}
      {...props}
    >
      <span
        className={cn(
          dd.label(),
          "group-data-selected:font-bold group-data-selected:text-primary-700",
        )}
      >
        {children}
      </span>
      <ComboboxPrimitive.ItemIndicator className="flex flex-shrink-0">
        <CheckIcon />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({ className, ...props }: WithClassName<ComboboxPrimitive.Group.Props>) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={className} {...props} />
}

// Catalog-style group heading.
function ComboboxLabel({ className, ...props }: WithClassName<ComboboxPrimitive.GroupLabel.Props>) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn(
        "px-5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.6px] text-[#9CA3AF]",
        className,
      )}
      {...props}
    />
  )
}

// No-match row.
function ComboboxEmpty({ className, ...props }: WithClassName<ComboboxPrimitive.Empty.Props>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("px-5 py-2.5 empty:hidden", dropdown().label(), className)}
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
}
