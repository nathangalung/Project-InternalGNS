import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { closeDecision, isTopModal, popModal, pushModal } from "./modalStack"
import { lockScroll } from "./scrollLock"

type ModalProps = {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  // Width override (default matches the legacy ca-modal 672px).
  className?: string
}

// Shared modal shell.
//
// The Base UI dialog in the legacy ca-modal look. Base UI traps focus and
// turns Escape and a backdrop click into a close request. The app keeps
// three guarantees of its own on top: the modal stack, so only the topmost
// of several open modals honours Escape or an outside click; the scroll
// lock on <main>, which is what scrolls in the app shell (Base UI locks the
// document); and focus return to the opener, since callers unmount the
// modal outright instead of closing it. The modal is open while mounted.
export default function Modal({ title, onClose, children, footer, className }: ModalProps) {
  const popupRef = useRef<HTMLDivElement>(null)
  const tokenRef = useRef<symbol | null>(null)
  // Opener captured before children autofocus.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement))

  // Latest onClose without re-registering.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Stack, scroll lock, focus return.
  useEffect(() => {
    const token = pushModal()
    tokenRef.current = token
    const release = lockScroll(document.querySelector("main"))
    return () => {
      popModal(token)
      tokenRef.current = null
      release()
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [opener])

  const onOpenChange = (open: boolean, details: DialogPrimitive.Root.ChangeEventDetails) => {
    const token = tokenRef.current
    const decision = closeDecision(open, details.reason, token !== null && isTopModal(token))
    if (decision === "cancel") details.cancel()
    if (decision === "close") onCloseRef.current()
  }

  // Autofocused child wins, else panel.
  const initialFocus = () => {
    const popup = popupRef.current
    return popup?.contains(document.activeElement) ? false : popup
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        ref={popupRef}
        aria-modal="true"
        initialFocus={initialFocus}
        finalFocus={false}
        className={className}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
