import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import type { ComponentProps } from "react"
import { ui } from "@/lib/ui"
import { cn, type WithClassName } from "@/lib/utils"

// Dialog primitives, legacy ca-* look.
//
// shadcn/ui's Base UI dialog restyled to the ca-overlay/ca-modal shell:
// a blurred black/50 backdrop, a 672px panel centred by flex (not a
// transform, which can land on half pixels), and no open or close motion,
// since the app has none. The layer sits at z-100, under the toasts.

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

// Portal, backdrop, viewport, panel.
function DialogContent({
  className,
  children,
  ...props
}: WithClassName<DialogPrimitive.Popup.Props>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-[4px]"
      />
      <DialogPrimitive.Viewport
        data-slot="dialog-viewport"
        className="fixed inset-0 z-[100] flex items-center justify-center"
      >
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "relative flex max-h-[92vh] w-[672px] max-w-[92vw] flex-col overflow-hidden rounded-xl bg-white shadow-lg outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  )
}

// Title row with close.
function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        "flex flex-shrink-0 items-center justify-between gap-4 px-10 pb-4 pt-8 max-sm:px-6",
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: WithClassName<DialogPrimitive.Title.Props>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-2xl font-bold leading-8 tracking-tight text-dark-900", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: WithClassName<DialogPrimitive.Description.Props>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-dark-600", className)}
      {...props}
    />
  )
}

// Icon close button, "Tutup".
function DialogCloseButton({ className, ...props }: WithClassName<DialogPrimitive.Close.Props>) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      aria-label="Tutup"
      className={cn(
        "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm text-dark-600 transition hover:bg-dark-100",
        ui.focusRing,
        className,
      )}
      {...props}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <line x1="1" y1="1" x2="13" y2="13" />
        <line x1="13" y1="1" x2="1" y2="13" />
      </svg>
    </DialogPrimitive.Close>
  )
}

// Scrolling content area.
function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("flex flex-col gap-8 overflow-y-auto px-10 pb-4 max-sm:px-6", className)}
      {...props}
    />
  )
}

// Grey action footer.
function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "mt-auto flex flex-shrink-0 flex-wrap items-center justify-end gap-4 border-t border-[rgba(203,213,225,0.15)] bg-dark-100 px-10 py-8 max-sm:px-6",
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
