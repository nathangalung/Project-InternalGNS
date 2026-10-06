import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as clientsApi from "@/features/clients/api"
import { contactEmailError } from "@/features/clients/helpers"
import { errorMessage } from "@/lib/errors"
import { type LookupOptions, lookupThrow } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { uploadWithFreshKey } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"

export function useClients(params: clientsApi.ClientListParams = {}, lookup: LookupOptions = {}) {
  return useQuery({
    queryKey: queryKeys.clients.list(params),
    queryFn: () => clientsApi.list(params),
    ...lookupThrow(lookup),
    placeholderData: keepPreviousData,
  })
}

export function useClientSummary() {
  return useQuery({
    queryKey: queryKeys.clients.summary(),
    queryFn: () => clientsApi.summary(),
  })
}

export function useClient(id: number | undefined, lookup: LookupOptions = {}) {
  return useQuery({
    queryKey: id ? queryKeys.clients.detail(id) : queryKeys.clients.all,
    queryFn: id !== undefined && id > 0 ? () => clientsApi.get(id) : skipToken,
    ...lookupThrow(lookup),
  })
}

export function useClientSearch(
  q: string,
  options: { minScore?: number; limit?: number } = {},
  lookup: LookupOptions = {},
) {
  return useQuery({
    queryKey: queryKeys.clients.search(q),
    queryFn: () => clientsApi.search(q, options),
    enabled: q.trim().length > 0,
    ...lookupThrow(lookup),
  })
}

// Failures show in the form.
export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: clientsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
  })
}

// Failures show in the form.
export function useUpdateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: clientsApi.UpdateClientInput }) =>
      clientsApi.update(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients.all })
      // Document lists and dashboards print the client name.
      for (const key of [
        queryKeys.quotations.all,
        queryKeys.purchaseOrders.all,
        queryKeys.invoices.all,
        queryKeys.dashboard.all,
      ]) {
        void qc.invalidateQueries({ queryKey: key })
      }
    },
  })
}

// Contacts of a client.
//
// A secondary card: a failure shows in it, not on the route error boundary,
// which would replace the page and its unsaved form.
export function useClientContacts(companyId: number | undefined) {
  return useQuery({
    queryKey: companyId ? queryKeys.clients.contacts(companyId) : queryKeys.clients.all,
    queryFn:
      companyId !== undefined && companyId > 0
        ? () => clientsApi.listContacts(companyId)
        : skipToken,
    throwOnError: false,
  })
}

export function useUpdateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      companyId,
      contactId,
      input,
    }: {
      companyId: number
      contactId: number
      input: Parameters<typeof clientsApi.updateContact>[2]
    }) => clientsApi.updateContact(companyId, contactId, input),
    onSuccess: (_, { companyId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients.contacts(companyId) })
      // List rows and the detail embed the main contact. The detail form
      // copies its fields once, so a refetch never clobbers its edits.
      void qc.invalidateQueries({ queryKey: queryKeys.clients.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.clients.detail(companyId) })
    },
    // A taken email sits on the form's email input.
    onError: (err) => {
      if (!contactEmailError(err)) toast.error(errorMessage(err, "Gagal memperbarui narahubung."))
    },
  })
}

// Callers report failures.
export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      companyId,
      input,
    }: {
      companyId: number
      input: Parameters<typeof clientsApi.createContact>[1]
    }) => clientsApi.createContact(companyId, input),
    onSuccess: (_, { companyId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients.contacts(companyId) })
      // A first contact becomes the main one shown on lists and the detail.
      void qc.invalidateQueries({ queryKey: queryKeys.clients.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.clients.detail(companyId) })
    },
  })
}

export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ companyId, contactId }: { companyId: number; contactId: number }) =>
      clientsApi.deleteContact(companyId, contactId),
    onSuccess: (_, { companyId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.clients.contacts(companyId) })
      void qc.invalidateQueries({ queryKey: queryKeys.clients.lists() })
      // Removing the main contact promotes the next one.
      void qc.invalidateQueries({ queryKey: queryKeys.clients.detail(companyId) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menonaktifkan narahubung.")),
  })
}

export function useUploadClientLogo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      validateAsset("clientLogo", file)
      const objectKey = await uploadWithFreshKey(
        () => clientsApi.presignLogoUpload(id, file.name),
        file,
      )
      await clientsApi.updateLogo(id, objectKey)
    },
    onSuccess: (_, { id }) => {
      // Detail carries the new object key that the logo URL query depends on.
      // Lists do not render logos, so the broad prefix is not needed.
      qc.invalidateQueries({ queryKey: queryKeys.clients.detail(id) })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengunggah logo.")),
  })
}

export function useClientLogoDownloadUrl(id: number | undefined, objectKey?: string) {
  return useQuery({
    queryKey: id ? [...queryKeys.clients.detail(id), "logo-url", objectKey] : queryKeys.clients.all,
    queryFn:
      id !== undefined && id > 0 && objectKey
        ? () => clientsApi.presignLogoDownload(id)
        : skipToken,
    staleTime: 4 * 60 * 1000,
  })
}

// The newest quotations, newest first.
//
// A secondary section: a failure shows in it, not on the route error
// boundary, which would replace the page and its unsaved form.
export function useClientRecentQuotations(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.clients.quotations(id) : queryKeys.clients.all,
    queryFn: id !== undefined && id > 0 ? () => clientsApi.listRecentQuotations(id) : skipToken,
    throwOnError: false,
  })
}
