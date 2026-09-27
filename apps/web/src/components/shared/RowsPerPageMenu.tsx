import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type RowsPerPageMenuProps = {
  value: number
  options: readonly number[]
  onChange: (n: number) => void
  // Trigger look differs per table
  triggerClassName: string
  panelClassName?: string
  rowClassName?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

// "N Baris" page-size menu.
//
// Opens above its trigger, 8px up, the status panel with a purple check on
// the current size. Picking a size closes the menu.
export default function RowsPerPageMenu({
  value,
  options,
  onChange,
  triggerClassName,
  panelClassName,
  rowClassName,
  open,
  onOpenChange,
}: RowsPerPageMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {/* Wrapper keeps the old flex item, so a wrapped label sizes the same */}
      <div className="inline-block">
        <DropdownMenuTrigger className={triggerClassName}>
          {value} Baris
          <svg aria-hidden="true" width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path
              d="M1 1L5 5L9 1"
              stroke="#4A4455"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent side="top" className={panelClassName}>
        <DropdownMenuRadioGroup value={value}>
          {options.map((n) => (
            <DropdownMenuRadioItem
              key={n}
              value={n}
              onClick={() => onChange(n)}
              className={rowClassName}
            >
              <span
                className={`text-[12px] leading-6 ${
                  n === value ? "font-semibold text-primary-700" : "font-normal text-[#4A4455]"
                }`}
              >
                {n} Baris
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
