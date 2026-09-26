import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon } from "@/components/document/icons"
import { dropdown, field } from "@/lib/ui"
import { cn, type WithClassName } from "@/lib/utils"

// Select primitives, ca-select look.
//
// The trigger is the grey ca-select-btn field; the list is the dropdown
// panel, anchored 4px below the trigger at its width (not overlapping it,
// as Base UI does by default), with a check on the chosen row.

const Select = SelectPrimitive.Root

function SelectValue({ className, ...props }: WithClassName<SelectPrimitive.Value.Props>) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("truncate text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: WithClassName<SelectPrimitive.Trigger.Props>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(field().selectTrigger(), "gap-2 data-placeholder:text-dark-500", className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="flex-shrink-0">
        <ChevronDown />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

type PositionProps = Pick<
  SelectPrimitive.Positioner.Props,
  "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
>

function SelectContent({
  className,
  children,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  alignItemWithTrigger = false,
  ...props
}: WithClassName<SelectPrimitive.Popup.Props> & PositionProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-[110]"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            dropdown({ placement: "floating" }).panel(),
            "max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto outline-none",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

// Option row, bold when chosen.
function SelectItem({ className, children, ...props }: WithClassName<SelectPrimitive.Item.Props>) {
  const dd = dropdown()
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(dd.item(), "group outline-none data-highlighted:bg-dark-100", className)}
      {...props}
    >
      <SelectPrimitive.ItemText
        className={cn(
          dd.label(),
          "group-data-selected:font-bold group-data-selected:text-primary-700",
        )}
      >
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="flex flex-shrink-0">
        <CheckIcon />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

// Field chevron, 12px.
function ChevronDown() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
