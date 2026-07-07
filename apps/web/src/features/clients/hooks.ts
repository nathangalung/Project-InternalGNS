import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as clientsApi from "@/features/clients/api"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { uploadToPresignedUrl } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"

export function useClients(params: clientsApi.ClientListParams = {}) {
  return useQuery({
    queryKey: queryKeys.clients.list(params),
    queryFn: () => clientsApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function useClientSummary() {
  return useQuery({
    queryKey: queryKeys.clients.summary(),
    queryFn: () => clientsApi.summary(),
  })
}

export function useClient(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.clients.detail(id) : queryKeys.clients.all,
    queryFn: () => clientsApi.get(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function useClientSearch(q: string, options: { minScore?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.clients.search(q),
    queryFn: () => clientsApi.search(q, options),
    enabled: q.trim().length > 0,
  })
}

export function useCreateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: clientsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan klien.")),
  })
}

export function useUpdateClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: clientsApi.UpdateClientInput }) =>
      clientsApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.clients.all }),
    onError: (err) => toast.error(errorMessage(err, "Gagal memperbarui klien.")),
  })
}

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
      // List rows embed contact fields, so refresh them too.
      void qc.invalidateQueries({ queryKey: queryKeys.clients.all })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal menyimpan kontak.")),
  })
}

export function useUploadClientLogo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      validateAsset("clientLogo", file)
      const presign = await clientsApi.presignLogoUpload(id, file.name)
      await uploadToPresignedUrl(presign.uploadUrl, file)
      await clientsApi.updateLogo(id, presign.objectKey)
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.clients.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.clients.all })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengunggah logo.")),
  })
}

export function useClientLogoDownloadUrl(id: number | undefined, objectKey?: string) {
  return useQuery({
    queryKey: id ? [...queryKeys.clients.detail(id), "logo-url", objectKey] : queryKeys.clients.all,
    queryFn: () => clientsApi.presignLogoDownload(id as number),
    enabled: id !== undefined && id > 0 && Boolean(objectKey),
    staleTime: 4 * 60 * 1000,
  })
}
