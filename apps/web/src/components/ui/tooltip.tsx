import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn, type WithClassName } from "@/lib/utils"

// Tooltip primitives, chart tooltip look.
//
// Dark-900 card with a faint purple edge and white caption text, the same
// card the trend chart draws. It opens on hover and on keyboard focus, and
// has no motion: it is read many times in a row.

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

type PositionProps = Pick<
  TooltipPrimitive.Positioner.Props,
  "align" | "alignOffset" | "side" | "sideOffset"
>

function TooltipContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "top",
  sideOffset = 8,
  ...props
}: WithClassName<TooltipPrimitive.Popup.Props> & PositionProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="z-[110]"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "max-w-xs origin-(--transform-origin) rounded-md border border-primary-600/40 bg-dark-900 px-3 py-2 text-caption text-white shadow-md",
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
