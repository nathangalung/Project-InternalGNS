import { type HistoryState, useNavigate, useRouter, useRouterState } from "@tanstack/react-router"
import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { type Crumb, crumbTarget, pageLabel, pushTrail, readTrail } from "@/lib/nav-trail"

// Open page name, by path.
//
// fallback is the breadcrumb the page shows without a trail, so a link from
// it carries those crumbs on.
type PageName = { path: string; label: string; fallback: Crumb[] }

type PageNameStore = {
  name: PageName | null
  setName: (name: PageName) => void
}

const PageNameContext = createContext<PageNameStore | null>(null)

// Holds the open page's name.
//
// A detail page names itself once its record loads; links on it read the
// name to label the crumb they leave behind.
export function PageNameProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<PageName | null>(null)
  const value = useMemo(() => ({ name, setName }), [name])
  return createElement(PageNameContext.Provider, { value }, children)
}

// Names the open page.
//
// fallback must keep its identity across renders.
export function usePageName(label: string, fallback: Crumb[]): void {
  const setName = useContext(PageNameContext)?.setName
  const path = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => {
    setName?.({ path, label, fallback })
  }, [setName, path, label, fallback])
}

// The open page's own name, if set.
function useOwnName(pathname: string): PageName | undefined {
  const name = useContext(PageNameContext)?.name
  return name?.path === pathname ? name : undefined
}

// The open page as a crumb.
export function useHere(): Crumb {
  const location = useRouterState({ select: (s) => s.location })
  const { pathname } = location
  const label = useOwnName(pathname)?.label ?? pageLabel(pathname)
  return { href: location.href, path: pathname, label, index: location.state.__TSR_index }
}

// Trail behind the open page.
function useTrail(): Crumb[] {
  const state = useRouterState({ select: (s) => s.location.state })
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return useMemo(() => readTrail(state, pathname), [state, pathname])
}

// State for a link from here.
//
// Pass it as `state` on a Link or navigate into another page, so that page
// knows the way back. A page opened without a trail passes on the crumbs
// its breadcrumb shows instead.
export function useTrailState(): HistoryState {
  const trail = useTrail()
  const here = useHere()
  const fallback = useOwnName(here.path)?.fallback
  return useMemo(() => {
    const before = trail.length > 0 ? trail : (fallback ?? [])
    return { trail: pushTrail(before, here) }
  }, [trail, fallback, here])
}

export type NavTrail = {
  // The trail, or the fallback when there is none
  crumbs: Crumb[]
  // Where Kembali goes
  previous: Crumb
  goTo: (at: number) => void
  back: () => void
  // After a save: back along the trail, else open the page
  leaveTo: (page: Crumb) => void
}

// Breadcrumb trail and its moves.
//
// fallback is shown, and followed, when the page was opened without a
// trail: from the menu, a bookmark or a new tab.
export function useNavTrail(fallback: Crumb[]): NavTrail {
  const router = useRouter()
  const navigate = useNavigate()
  const trail = useTrail()
  const index = useRouterState({ select: (s) => s.location.state.__TSR_index })
  const crumbs = trail.length > 0 ? trail : fallback

  const goTo = useCallback(
    (at: number) => {
      const target =
        trail.length > 0
          ? crumbTarget(trail, at, index)
          : ({ kind: "open", href: fallback[at].href, trail: fallback.slice(0, at) } as const)
      if (target.kind === "history") router.history.go(target.delta)
      else void navigate({ href: target.href, state: { trail: target.trail } })
    },
    [trail, fallback, index, router, navigate],
  )

  const leaveTo = useCallback(
    (page: Crumb) => {
      const last = trail.length - 1
      if (last >= 0 && trail[last].path === page.path) goTo(last)
      else void navigate({ href: page.href, state: { trail } })
    },
    [trail, goTo, navigate],
  )

  return {
    crumbs,
    previous: crumbs[crumbs.length - 1],
    goTo,
    back: () => goTo(crumbs.length - 1),
    leaveTo,
  }
}
