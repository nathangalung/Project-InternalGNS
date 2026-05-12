package storage

// DNS-compliant bucket names (S3/MinIO require lowercase, 3-63 chars,
// letters/digits/hyphens, no underscores, no leading/trailing hyphen).
const (
	BucketPODocs             = "po-docs"
	BucketClientLogos        = "client-logos"
	BucketVendorLogos        = "vendor-logos"
	BucketItemImages         = "item-images"
	BucketInvoiceAttachments = "invoice-attachments"
)

// AllBuckets is the canonical set ensured at boot.
var AllBuckets = []string{
	BucketPODocs,
	BucketClientLogos,
	BucketVendorLogos,
	BucketItemImages,
	BucketInvoiceAttachments,
}
