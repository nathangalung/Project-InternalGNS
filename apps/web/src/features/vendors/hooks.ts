import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as vendorsApi from "@/features/vendors/api"
import { errorMessage } from "@/lib/errors"
import { queryKeys } from "@/lib/query-keys"
import { uploadToPresignedUrl } from "@/lib/storage-upload"
import { toast } from "@/lib/toast"
import { validateAsset } from "@/lib/upload-validation"

export function useVendors(params: vendorsApi.VendorListParams = {}) {
  return useQuery({
    queryKey: queryKeys.vendors.list(params),
    queryFn: () => vendorsApi.list(params),
    placeholderData: keepPreviousData,
  })
}

export function useVendor(id: number | undefined) {
  return useQuery({
    queryKey: id ? queryKeys.vendors.detail(id) : queryKeys.vendors.all,
    queryFn: () => vendorsApi.get(id as number),
    enabled: id !== undefined && id > 0,
  })
}

export function useVendorItems(vendorId: number | undefined) {
  return useQuery({
    queryKey: vendorId ? queryKeys.vendors.items(vendorId) : queryKeys.vendors.all,
    queryFn: () => vendorsApi.listItems(vendorId as number),
    enabled: vendorId !== undefined && vendorId > 0,
  })
}

export function useCreateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: vendorsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.vendors.all }),
  })
}

export function useUpdateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: vendorsApi.UpdateVendorInput }) =>
      vendorsApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.vendors.all }),
    onError: (err) => toast.error(errorMessage(err, "Gagal memperbarui vendor.")),
  })
}

export function useUploadVendorLogo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      validateAsset("vendorLogo", file)
      const presign = await vendorsApi.presignLogoUpload(id, file.name)
      await uploadToPresignedUrl(presign.uploadUrl, file)
      await vendorsApi.updateLogo(id, presign.objectKey)
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.vendors.detail(id) })
      qc.invalidateQueries({ queryKey: queryKeys.vendors.all })
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengunggah logo vendor.")),
  })
}

export function useVendorLogoDownloadUrl(id: number | undefined, objectKey?: string) {
  return useQuery({
    queryKey: id ? [...queryKeys.vendors.detail(id), "logo-url", objectKey] : queryKeys.vendors.all,
    queryFn: () => vendorsApi.presignLogoDownload(id as number),
    enabled: id !== undefined && id > 0 && Boolean(objectKey),
    staleTime: 4 * 60 * 1000,
  })
}
