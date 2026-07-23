import { useQuery } from "@tanstack/react-query"
import * as dashboardApi from "@/features/dashboard/api"
import { queryKeys } from "@/lib/query-keys"
import type { DashboardMetric } from "@/types/api"

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: dashboardApi.summary,
  })
}

export function useDashboardTimeseries(
  metric: DashboardMetric,
  from?: string,
  to?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.dashboard.timeseries(metric, from, to),
    queryFn: () => dashboardApi.timeseries(metric, from, to),
    enabled,
  })
}
