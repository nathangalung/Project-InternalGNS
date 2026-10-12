import { createFileRoute } from "@tanstack/react-router"
import CashEntryList from "@/features/cashEntries/CashEntryList"
import { validateCashSearch } from "@/features/cashEntries/list-search"

export const Route = createFileRoute("/_authed/cash-entries/")({
  validateSearch: validateCashSearch,
  component: CashEntryList,
})
