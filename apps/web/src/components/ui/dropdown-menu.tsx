import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { CheckIcon } from "@/components/document/icons"
import { statusMenu } from "@/lib/ui"
import { cn, type WithClassName } from "@/lib/utils"

// Menu primitives, status dropdown look.
//
// The 162px qd-status panel 8px under its trigger, start-aligned, with
// 32px rows. Rows take focus on arrow keys and show the inset ring. The
// menu is not modal: like the hand-rolled panels it replaces, it locks no
// scroll and an outside press still reaches its target.

function DropdownMenu({ modal = false, ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root modal={modal} {...props} />
}

const DropdownMenuTrigger = MenuPrimitive.Trigger
const DropdownMenuGroup = MenuPrimitive.Group
const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup

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

const itemCls =
  "cursor-pointer outline-none data-highlighted:bg-dark-100 data-disabled:pointer-events-none data-disabled:opacity-50"

function DropdownMenuItem({ className, ...props }: WithClassName<MenuPrimitive.Item.Props>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(statusMenu().option(), itemCls, className)}
      {...props}
    />
  )
}

// Choice row with check.
function DropdownMenuRadioItem({
  className,
  children,
  closeOnClick = true,
  indicator = true,
  ...props
}: WithClassName<MenuPrimitive.RadioItem.Props> & { indicator?: boolean }) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      closeOnClick={closeOnClick}
      className={cn(statusMenu().option(), itemCls, className)}
      {...props}
    >
      {children}
      {indicator && (
        <MenuPrimitive.RadioItemIndicator className="flex">
          <CheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      )}
    </MenuPrimitive.RadioItem>
  )
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
}
