import { useQuery } from "@tanstack/react-query"
import * as countriesApi from "@/features/countries/api"
import { queryKeys } from "@/lib/query-keys"

export function useCountries() {
  return useQuery({
    queryKey: queryKeys.countries.list(),
    queryFn: countriesApi.list,
    staleTime: 60 * 60_000,
  })
}
