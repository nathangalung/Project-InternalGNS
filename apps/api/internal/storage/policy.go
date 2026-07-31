package storage

import (
	"fmt"
	"path"
	"strings"
)

// Per-bucket extension allowlist.
var bucketExtensions = map[string]map[string]struct{}{
	BucketClientLogos:        imageExts(),
	BucketVendorLogos:        imageExts(),
	BucketItemImages:         imageExts(),
	BucketInvoiceAttachments: docExts(),
	BucketPODocs:             docExts(),
}

// Per-bucket role allowlist, mirroring the resource RBAC: logos and item
// images are shared master data; invoice attachments follow /invoices;
// PO documents follow /purchase-orders.
var bucketRoles = map[string][]string{
	BucketClientLogos:        {"superadmin", "operational", "finance"},
	BucketVendorLogos:        {"superadmin", "operational", "finance"},
	BucketItemImages:         {"superadmin", "operational", "finance"},
	BucketInvoiceAttachments: {"superadmin", "finance"},
	BucketPODocs:             {"superadmin", "operational"},
}

// CanAccessBucket reports whether a role may read or write a bucket.
func CanAccessBucket(role, bucket string) bool {
	for _, r := range bucketRoles[bucket] {
		if r == role {
			return true
		}
	}
	return false
}

// Per-bucket size cap in bytes.
var bucketMaxBytes = map[string]int64{
	BucketClientLogos:        2 * 1024 * 1024,
	BucketVendorLogos:        2 * 1024 * 1024,
	BucketItemImages:         5 * 1024 * 1024,
	BucketInvoiceAttachments: 20 * 1024 * 1024,
	BucketPODocs:             20 * 1024 * 1024,
}

func imageExts() map[string]struct{} {
	return map[string]struct{}{".png": {}, ".jpg": {}, ".jpeg": {}, ".webp": {}, ".gif": {}}
}

func docExts() map[string]struct{} {
	return map[string]struct{}{
		".pdf": {}, ".png": {}, ".jpg": {}, ".jpeg": {}, ".webp": {},
		".xlsx": {}, ".xls": {},
	}
}

// ValidateAssetFileName guards the extension allowlist per bucket.
func ValidateAssetFileName(bucket, fileName string) error {
	allowed, ok := bucketExtensions[bucket]
	if !ok {
		return fmt.Errorf("storage: unknown bucket %q", bucket)
	}
	ext := strings.ToLower(path.Ext(fileName))
	if _, has := allowed[ext]; !has {
		return fmt.Errorf("extension %q not allowed for %s", ext, bucket)
	}
	return nil
}

// ValidateAssetSize guards the byte cap per bucket. Pass 0 to skip.
func ValidateAssetSize(bucket string, size int64) error {
	cap, ok := bucketMaxBytes[bucket]
	if !ok {
		return fmt.Errorf("storage: unknown bucket %q", bucket)
	}
	if size > 0 && size > cap {
		return fmt.Errorf("size %d exceeds %d for %s", size, cap, bucket)
	}
	return nil
}

// MaxBytes returns the policy cap for a bucket.
func MaxBytes(bucket string) int64 {
	return bucketMaxBytes[bucket]
}
