import { apiRequest } from "@/lib/api-client"
import type { DashboardMetric, DashboardSummary, DashboardTimeseriesPoint } from "@/types/api"

export async function summary(): Promise<DashboardSummary> {
  return apiRequest<DashboardSummary>({ path: "/dashboard/summary" })
}

export async function timeseries(
  metric: DashboardMetric,
  from?: string,
  to?: string,
): Promise<DashboardTimeseriesPoint[]> {
  const params = new URLSearchParams({ metric })
  if (from) params.set("from", from)
  if (to) params.set("to", to)
  return apiRequest<DashboardTimeseriesPoint[]>({
    path: `/dashboard/timeseries?${params.toString()}`,
  })
}
