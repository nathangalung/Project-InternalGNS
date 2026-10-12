import { useMemo, useState } from "react"
import { dedupeByCompany, fromClientHit, fromClientRow } from "@/features/clients/helpers"
import { useClient, useClientContacts, useClientSearch, useClients } from "@/features/clients/hooks"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { lookupFailure } from "@/lib/lookup"
import { INLINE_LOOKUP } from "@/lib/query-client"
import {
  PICKER_PAGE_SIZE,
  type PickClient,
  pickerWindow,
  resolveClient,
  visibleClients,
} from "./wizardClient"

// Paged client picker.
//
// Every active client a page at a time by name; a search pages its hits
// here. The picked client stays in view on any page, fetched by id when the
// page does not hold it. A failed lookup shows in the picker, never on the
// route error boundary, which would discard the document being edited.
export function useClientPicker(selectedClient: string) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const searching = debouncedSearch.length > 0

  const clientsQuery = useClients(
    {
      limit: PICKER_PAGE_SIZE,
      offset: (page - 1) * PICKER_PAGE_SIZE,
      isActive: true,
      sortBy: "name",
      sortDir: "asc",
    },
    INLINE_LOOKUP,
  )
  // Every hit up to the API cap, paged here
  const searchQuery = useClientSearch(debouncedSearch, { limit: 200 }, INLINE_LOOKUP)
  const clientsData = clientsQuery.data
  const searchHits = searchQuery.data

  const numericClientId = Number(selectedClient)
  const pickedId = numericClientId > 0 ? numericClientId : undefined
  const contactsQuery = useClientContacts(pickedId)
  const contacts = contactsQuery.data ?? []

  const remoteClients: PickClient[] = useMemo(() => {
    if (searching) return dedupeByCompany(searchHits ?? []).map(fromClientHit)
    return (clientsData?.rows ?? []).map(fromClientRow)
  }, [searching, searchHits, clientsData])

  const isListed = remoteClients.some((c) => c.id === selectedClient)
  const selectedQuery = useClient(isListed ? undefined : pickedId, INLINE_LOOKUP)
  const clientsFailure = lookupFailure(searching ? searchQuery : clientsQuery, selectedQuery)
  const currentClient = useMemo(
    () => resolveClient(remoteClients, selectedClient, selectedQuery.data),
    [remoteClients, selectedClient, selectedQuery.data],
  )

  const sortedClients = [...remoteClients].sort((a, b) => a.name.localeCompare(b.name, "id"))
  const total = searching ? sortedClients.length : (clientsData?.total ?? 0)
  const view = pickerWindow(total, page)
  const pageRows = searching
    ? sortedClients.slice(view.start, view.start + PICKER_PAGE_SIZE)
    : sortedClients

  // A new search starts on page 1
  function changeSearch(s: string) {
    setSearch(s)
    setPage(1)
  }

  return {
    search,
    changeSearch,
    filteredClients: visibleClients(pageRows, currentClient, PICKER_PAGE_SIZE + 1),
    currentClient,
    contacts,
    // The picked client's contacts are still loading
    contactsPending: pickedId !== undefined && contactsQuery.isPending,
    clientsFailure,
    picker: {
      page: view.page,
      pages: view.pages,
      from: view.from,
      to: view.to,
      total,
      onPage: setPage,
    },
  }
}
