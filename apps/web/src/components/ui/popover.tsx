import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { dropdown } from "@/lib/ui"
import { cn, type WithClassName } from "@/lib/utils"

// Popover primitives, dropdown panel look.
//
// The panel is the app's dropdown panel (white, faint purple border, soft
// shadow), 4px under the trigger. No open or close motion, matching the
// hand-rolled panels. The positioner sits at z-110 so a popover opened
// inside a modal (z-100) stays on top.

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverClose = PopoverPrimitive.Close

type PositionProps = Pick<
  PopoverPrimitive.Positioner.Props,
  "align" | "alignOffset" | "side" | "sideOffset"
>

function PopoverContent({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: WithClassName<PopoverPrimitive.Popup.Props> & PositionProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="z-[110]"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            dropdown({ placement: "floating" }).panel(),
            "max-h-(--available-height) origin-(--transform-origin) overflow-y-auto outline-none",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverClose, PopoverContent, PopoverTrigger }
