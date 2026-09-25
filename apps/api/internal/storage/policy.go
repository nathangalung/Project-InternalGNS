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

// bucketRoles mirrors the resource RBAC.
// Logos and item images are shared master data; invoice attachments follow
// /invoices; PO documents follow /purchase-orders.
var bucketRoles = map[string][]string{
	BucketClientLogos:        {"superadmin", "operational", "finance"},
	BucketVendorLogos:        {"superadmin", "operational", "finance"},
	BucketItemImages:         {"superadmin", "operational", "finance"},
	BucketInvoiceAttachments: {"superadmin", "finance"},
	BucketPODocs:             {"superadmin", "operational"},
}

// CanAccessBucket checks role bucket access.
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

// ValidateAssetFileName checks bucket extensions.
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

// ValidateOwnedKey binds keys to records.
// Attach endpoints take the key from the request body, so without this a
// caller could point a record at any object in the bucket, or at a traversal
// path outside it. BuildObjectKey is what produces a conforming key.
func ValidateOwnedKey(bucket, prefix string, id int64, key string) error {
	return ValidateFolderKey(bucket, OwnerFolder(prefix, id, ""), key)
}

// ValidateFolderKey binds keys to folders.
// The name must sit directly in the folder: a key in a sub-folder belongs to
// another asset of the same record. BuildFolderKey produces a conforming key.
func ValidateFolderKey(bucket, folder, key string) error {
	if !safeKey(key) {
		return fmt.Errorf("storage: unsafe object key %q", key)
	}
	name, ok := strings.CutPrefix(key, folder)
	if !ok || name == "" || strings.Contains(name, "/") {
		return fmt.Errorf("storage: object key %q is not directly under %q", key, folder)
	}
	return ValidateAssetFileName(bucket, key)
}

// MaxBytes returns a bucket's cap.
func MaxBytes(bucket string) int64 {
	return bucketMaxBytes[bucket]
}
