// Escape ownership stack for modals.
// Each mounted Modal pushes a token and only the topmost one reacts to Escape,
// so a single keypress never dismisses stacked modals at once.
const stack: symbol[] = []

export function pushModal(): symbol {
  const token = Symbol("modal")
  stack.push(token)
  return token
}

// Removes by identity, so modals may unmount out of order.
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
