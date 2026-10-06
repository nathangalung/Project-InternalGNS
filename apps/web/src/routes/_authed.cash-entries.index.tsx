import { createFileRoute } from "@tanstack/react-router"
import CashEntryList from "@/features/cashEntries/CashEntryList"

export const Route = createFileRoute("/_authed/cash-entries/")({
  component: CashEntryList,
})
