import { useQuery } from "@tanstack/react-query";
import * as unitsApi from "@/features/units/api";
import { queryKeys } from "@/lib/query-keys";

export function useUnits() {
  return useQuery({
    queryKey: queryKeys.units.list(),
    queryFn: unitsApi.list,
    staleTime: 5 * 60_000,
  });
}
