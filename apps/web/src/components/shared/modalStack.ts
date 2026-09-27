// Escape ownership stack for modals.
//
// Each mounted Modal pushes a token and only the topmost one reacts to Escape,
// so a single keypress never dismisses stacked modals at once.
const stack: symbol[] = []

export function pushModal(): symbol {
  const token = Symbol("modal")
  stack.push(token)
  return token
}

// Removes a modal by identity.
//
// Modals may unmount out of order.
export function popModal(token: symbol): void {
  const index = stack.lastIndexOf(token)
  if (index !== -1) stack.splice(index, 1)
}

export function isTopModal(token: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token
}

// Test-only leak observation.
export function modalStackDepth(): number {
  return stack.length
}

// What a close request does.
//
// Escape and an outside click belong to the topmost modal only: a lower
// modal sees a click on the upper one as outside itself, and both hear the
// same keydown, so a lower one cancels them. The close button and any other
// request close the modal that raised it, as the hand-built shell did.
export type CloseDecision = "ignore" | "cancel" | "close"

export function closeDecision(open: boolean, reason: string, isTop: boolean): CloseDecision {
  if (open) return "ignore"
  if (!isTop && (reason === "escape-key" || reason === "outside-press")) return "cancel"
  return "close"
}
