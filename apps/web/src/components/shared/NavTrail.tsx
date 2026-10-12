import type { MouseEvent } from "react"
import { useNavTrail, usePageName } from "@/hooks/useNavTrail"
import type { Crumb } from "@/lib/nav-trail"
import { ui } from "@/lib/ui"

type NavTrailProps = {
  // This page's name, also the crumb it leaves behind
  current: string
  // Shown when the page was opened without a trail
  fallback: Crumb[]
}

// A plain left click, not a new tab.
function plainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

// Breadcrumb of the way here.
//
// Each crumb is a real anchor, so a new tab still opens it; a plain click
// goes back in history when it can, keeping the page as it was left.
export default function NavTrail({ current, fallback }: NavTrailProps) {
  usePageName(current, fallback)
  const { crumbs, goTo } = useNavTrail(fallback)
  return (
    <nav aria-label="Breadcrumb" className={ui.breadcrumb}>
      <ol className={ui.breadcrumbList}>
        {crumbs.map((crumb, i) => (
          <li key={`${i}-${crumb.path}`} className={ui.breadcrumbItem}>
            <a
              href={crumb.href}
              title={crumb.label}
              className={ui.breadcrumbLink}
              onClick={(e) => {
                if (!plainClick(e)) return
                e.preventDefault()
                goTo(i)
              }}
            >
              {crumb.label}
            </a>
            <span className={ui.breadcrumbSep} aria-hidden="true">
              &rsaquo;
            </span>
          </li>
        ))}
        <li className={ui.breadcrumbItem}>
          <span className={ui.breadcrumbCurrent} aria-current="page" title={current}>
            {current}
          </span>
        </li>
      </ol>
    </nav>
  )
}
