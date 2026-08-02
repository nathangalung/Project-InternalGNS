import { apiRequest, downloadXlsx } from "@/lib/api-client"
import type { DashboardMetric, DashboardSummary, DashboardTimeseriesPoint } from "@/types/api"

export async function summary(): Promise<DashboardSummary> {
  return apiRequest<DashboardSummary>({ path: "/dashboard/summary" })
}

// Download the dashboard summary + monthly series as XLSX (optional year scope).
export function exportXlsx(year?: number): Promise<void> {
  const qs = year ? `?year=${year}` : ""
  return downloadXlsx(`/dashboard/export.xlsx${qs}`, "dashboard-export.xlsx")
}

export async function timeseries(
  metric: DashboardMetric,
  from?: string,
  to?: string,
  interval?: "month" | "day",
): Promise<DashboardTimeseriesPoint[]> {
  const params = new URLSearchParams({ metric })
  if (from) params.set("from", from)
  if (to) params.set("to", to)
  if (interval) params.set("interval", interval)
  return apiRequest<DashboardTimeseriesPoint[]>({
    path: `/dashboard/timeseries?${params.toString()}`,
  })
}
