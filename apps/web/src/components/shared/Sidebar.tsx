import { useState } from "react"
import { useMe } from "@/features/auth/hooks"
import type { Page } from "@/lib/page"
import { roleCanAccess, type Section } from "@/lib/rbac"
import type { Role } from "@/types/api"

const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super Admin",
  operational: "Operasional",
  finance: "Finance",
}

const logoImg = "/logo.png"

const navItems: { label: string; icon: string; page?: Page }[] = [
  { label: "Dashboard", icon: "grid", page: "dashboard" },
  { label: "Dashboard Financial", icon: "bar-chart", page: "dashboard-financial" },
  { label: "Dashboard Operasional", icon: "activity", page: "dashboard-operational" },
  { label: "Quotation", icon: "file-text", page: "quotation" },
  { label: "Purchase Order", icon: "shopping-cart", page: "purchase-orders" },
  { label: "Invoices", icon: "file", page: "invoices" },
  { label: "Katalog Produk", icon: "package", page: "products" },
  { label: "Daftar Vendor", icon: "truck", page: "vendors" },
  { label: "Daftar Klien", icon: "users", page: "clients" },
  { label: "Manajemen Pengguna", icon: "settings", page: "users" },
]

interface SidebarProps {
  activePage: Page
  onNavigate: (page: Page) => void
  onLogout: () => void
}

function NavIcon({ name }: { name: string }) {
  const icons: Record<string, React.ReactElement> = {
    grid: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
    "bar-chart": (
      <svg viewBox="0 0 24 24">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    ),
    activity: (
      <svg viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    "file-text": (
      <svg viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    "shopping-cart": (
      <svg viewBox="0 0 24 24">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
    file: (
      <svg viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
    package: (
      <svg viewBox="0 0 24 24">
        <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    truck: (
      <svg viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    users: (
      <svg viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    settings: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  }
  return <span className="nav-icon">{icons[name]}</span>
}

export default function Sidebar({ activePage, onNavigate, onLogout }: SidebarProps) {
  const { data: me } = useMe()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const visibleItems = navItems.filter(
    (item) => !item.page || roleCanAccess(me?.role, item.page as Section),
  )

  const handleNavigate = (page: Page) => {
    setDrawerOpen(false)
    onNavigate(page)
  }

  return (
    <>
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-topbar-toggle"
          onClick={() => setDrawerOpen(true)}
          aria-label="Buka menu"
          aria-expanded={drawerOpen}
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <img src={logoImg} className="mobile-topbar-logo" alt="GNS" />
        <span className="mobile-topbar-title">PT Global Niaga Sakti</span>
      </header>

      {drawerOpen && (
        <button
          type="button"
          className="sidebar-overlay"
          aria-label="Tutup menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <aside className={`admin-sidebar${drawerOpen ? " admin-sidebar--open" : ""}`}>
        <div className="sidebar-brand">
          <img src={logoImg} className="sidebar-logo" alt="GNS" />
          <div className="sidebar-brand-text">
            <h2>PT Global Niaga Sakti</h2>
            <span>Admin Panel</span>
          </div>
          <button
            type="button"
            className="sidebar-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Tutup menu"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav">
          {visibleItems.map((item) => (
            <button
              key={item.label}
              className={`nav-item${item.page === activePage ? " nav-item--active" : ""}`}
              onClick={() => item.page && handleNavigate(item.page)}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{me?.name ?? ""}</div>
            <div className="sidebar-user-role">{me?.role ? ROLE_LABEL[me.role] : ""}</div>
          </div>
          <button className="logout-btn" onClick={onLogout} title="Keluar">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </aside>
    </>
  )
}
