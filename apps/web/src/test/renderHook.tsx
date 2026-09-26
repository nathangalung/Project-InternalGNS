import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

// Enable React act() flushing.
//
// React only flushes act() updates when this flag is set.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Wrapper = (props: { children: ReactNode }) => ReactNode

export type RenderedHook<P, R> = {
  result: { current: R }
  rerender: (props: P) => void
  unmount: () => void
}

// Minimal React 19 renderHook.
export function renderHook<P, R>(
  hook: (props: P) => R,
  initialProps: P,
  Wrapper: Wrapper = ({ children }) => children,
): RenderedHook<P, R> {
  const result = { current: undefined as R }
  const root = createRoot(document.createElement("div"))

  function Probe({ props }: { props: P }) {
    result.current = hook(props)
    return null
  }

  const render = (props: P) => {
    act(() => {
      root.render(
        <Wrapper>
          <Probe props={props} />
        </Wrapper>,
      )
    })
  }

  render(initialProps)
  return { result, rerender: render, unmount: () => act(() => root.unmount()) }
}
