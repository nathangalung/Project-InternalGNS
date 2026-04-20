import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import MainDashboard from "./components/dashboard/MainDashboard"
import LoginPage from "./components/auth/LoginPage"
import QuotationList from "./components/quotation/QuotationList"
import QuotationDetail from "./components/quotation/QuotationDetail"
import QuotationEdit from "./components/quotation/QuotationEdit"
import "./styles/design-tokens.css"
import "./styles/admin.css"

export type Page = "dashboard" | "quotation" | "quotation-detail" | "quotation-edit"

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("gns_auth") === "true"
  })
  const [page, setPage] = useState<Page>("dashboard")
  const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(null)

  const handleLogin = () => {
    sessionStorage.setItem("gns_auth", "true")
    setIsAuthenticated(true)
  }

  const handleLogout = () => {
    sessionStorage.removeItem("gns_auth")
    setIsAuthenticated(false)
    setPage("dashboard")
  }

  const handleViewDetail = (id: string) => {
    setSelectedQuotationId(id)
    setPage("quotation-detail")
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />
  }

  if (page === "quotation-edit" && selectedQuotationId) {
    return <QuotationEdit quotationId={selectedQuotationId} onNavigate={setPage} onLogout={handleLogout} />
  }

  if (page === "quotation-detail" && selectedQuotationId) {
    return <QuotationDetail quotationId={selectedQuotationId} onNavigate={setPage} onLogout={handleLogout} />
  }

  if (page === "quotation") {
    return <QuotationList onNavigate={setPage} onLogout={handleLogout} onViewDetail={handleViewDetail} />
  }

  return <MainDashboard onNavigate={setPage} onLogout={handleLogout} />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
