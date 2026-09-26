import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { statusMenu } from "@/lib/ui"
import { cn, type WithClassName } from "@/lib/utils"

// Menu primitives, status dropdown look.
//
// The 162px qd-status panel 8px under its trigger, start-aligned, with
// 32px rows. Rows take focus on arrow keys and show the inset ring.

const DropdownMenu = MenuPrimitive.Root
const DropdownMenuTrigger = MenuPrimitive.Trigger
const DropdownMenuGroup = MenuPrimitive.Group

type PositionProps = Pick<
  MenuPrimitive.Positioner.Props,
  "align" | "alignOffset" | "side" | "sideOffset"
>

function DropdownMenuContent({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 8,
  ...props
}: WithClassName<MenuPrimitive.Popup.Props> & PositionProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="z-[110] outline-none"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            statusMenu({ placement: "floating" }).panel(),
            "max-h-(--available-height) origin-(--transform-origin) overflow-y-auto outline-none",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

// Menu heading, e.g. "Ubah ke".
function DropdownMenuLabel({ className, ...props }: WithClassName<MenuPrimitive.GroupLabel.Props>) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn(
        "px-5 pb-1 text-overline font-bold uppercase tracking-[0.06em] text-dark-500",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({ className, ...props }: WithClassName<MenuPrimitive.Item.Props>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        statusMenu().option(),
        "cursor-pointer outline-none data-highlighted:bg-dark-100 data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
}
