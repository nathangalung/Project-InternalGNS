package storage

import (
	"fmt"
	"path"
	"slices"
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

// Per-bucket extension allowlist.
var bucketExtensions = map[string]map[string]struct{}{
	BucketClientLogos:        imageExts(),
	BucketVendorLogos:        imageExts(),
	BucketItemImages:         imageExts(),
	BucketInvoiceAttachments: docExts(),
	BucketPODocs:             docExts(),
}

// Role groups for buckets.
var (
	allRoles = []string{roles.Superadmin, roles.Operational, roles.OperationalInput, roles.Finance, roles.FinanceInput}
	opsWrite = []string{roles.Superadmin, roles.Operational, roles.OperationalInput}
	finance  = []string{roles.Superadmin, roles.Finance, roles.FinanceInput}
)

// bucketReaders mirrors the resource RBAC.
// Logos, item images and PO documents follow master data and
// /purchase-orders, which every role reads; invoice attachments and payment
// proofs follow /invoices.
var bucketReaders = map[string][]string{
	BucketClientLogos:        allRoles,
	BucketVendorLogos:        allRoles,
	BucketItemImages:         allRoles,
	BucketInvoiceAttachments: finance,
	BucketPODocs:             allRoles,
}

// bucketWriters mirrors the write RBAC.
// The finance roles only read /items, /vendors and purchase orders. The
// finance head keeps client writes, logo included; finance input changes
// only NPWP and TKU, so it stores no logo. Only the heads store a PO
// document, since operational input never touches a PO's file.
var bucketWriters = map[string][]string{
	BucketClientLogos:        {roles.Superadmin, roles.Operational, roles.OperationalInput, roles.Finance},
	BucketVendorLogos:        opsWrite,
	BucketItemImages:         opsWrite,
	BucketInvoiceAttachments: {roles.Superadmin, roles.Finance},
	BucketPODocs:             {roles.Superadmin, roles.Operational},
}

// CanReadBucket checks role read access.
func CanReadBucket(role, bucket string) bool {
	return slices.Contains(bucketReaders[bucket], role)
}

// CanWriteObject checks role write access.
// Finance input records payment, so beyond the bucket writers it stores a
// payment proof and nothing else of an invoice.
func CanWriteObject(role, bucket, key string) bool {
	if slices.Contains(bucketWriters[bucket], role) {
		return true
	}
	return role == roles.FinanceInput && bucket == BucketInvoiceAttachments && isPaymentProofKey(key)
}

// isPaymentProofKey matches a proof key.
// The name sits directly in invoices/<id>/payment/, the folder
// OwnerFolder gives a proof, so no attachment key passes.
func isPaymentProofKey(key string) bool {
	rest, ok := strings.CutPrefix(key, "invoices/")
	if !ok {
		return false
	}
	id, name, ok := strings.Cut(rest, "/payment/")
	if !ok || id == "" || strings.Trim(id, "0123456789") != "" {
		return false
	}
	return name != "" && name != "." && name != ".." && !strings.Contains(name, "/")
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
