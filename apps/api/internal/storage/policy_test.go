package storage

import (
	"slices"
	"testing"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

// Buckets follow the routes.
// Every role is asserted on every bucket. Finance roles read catalog images
// and PO documents only; finance input also stores no client logo.
// Operational roles never see invoice files, and only the heads store a PO
// document. The key here is one any writer could store.
func TestBucketAccess(t *testing.T) {
	const (
		s  = roles.Superadmin
		o  = roles.Operational
		oi = roles.OperationalInput
		f  = roles.Finance
		fi = roles.FinanceInput
	)
	all := []string{s, o, oi, f, fi}
	cases := []struct {
		bucket, key   string
		read, writers []string
	}{
		{BucketClientLogos, "clients/7/1-logo.png", all, []string{s, o, oi, f}},
		{BucketVendorLogos, "vendors/7/1-logo.png", all, []string{s, o, oi}},
		{BucketItemImages, "items/7/1-photo.webp", all, []string{s, o, oi}},
		{BucketPODocs, "po/7/1-po.pdf", all, []string{s, o}},
		{BucketInvoiceAttachments, "invoices/7/payment/1-proof.pdf", []string{s, f, fi}, []string{s, f, fi}},
		{"nonexistent-bucket", "x/7/1-a.pdf", nil, nil},
	}
	for _, c := range cases {
		for _, role := range append(all, "") {
			if got, want := CanReadBucket(role, c.bucket), slices.Contains(c.read, role); got != want {
				t.Errorf("CanReadBucket(%q, %q) = %v, want %v", role, c.bucket, got, want)
			}
			if got, want := CanWriteObject(role, c.bucket, c.key), slices.Contains(c.writers, role); got != want {
				t.Errorf("CanWriteObject(%q, %q, %q) = %v, want %v", role, c.bucket, c.key, got, want)
			}
		}
	}
}

// Finance input stores proofs only.
// It may add the payment proof of an invoice, never its attachment, and a
// key only resembling a proof folder is refused. The heads store either.
func TestCanWriteObject_InvoiceKeys(t *testing.T) {
	cases := []struct {
		key  string
		want bool
	}{
		{"invoices/7/payment/1-proof.pdf", true},
		{"invoices/12345/payment/1-bukti transfer.jpg", true},
		{"invoices/7/1-attachment.pdf", false},
		{"invoices/7/payment/", false},
		{"invoices/7/payment/sub/1-proof.pdf", false},
		{"invoices/7/payment/../1-attachment.pdf", false},
		{"invoices/7/payment/..", false},
		{"invoices/x7/payment/1-proof.pdf", false},
		{"invoices//payment/1-proof.pdf", false},
		{"invoices/7/payments/1-proof.pdf", false},
		{"other/invoices/7/payment/1-proof.pdf", false},
		{"/invoices/7/payment/1-proof.pdf", false},
		{"", false},
	}
	for _, c := range cases {
		if got := CanWriteObject(roles.FinanceInput, BucketInvoiceAttachments, c.key); got != c.want {
			t.Errorf("finance_input %q = %v, want %v", c.key, got, c.want)
		}
	}
	for _, role := range []string{roles.Superadmin, roles.Finance} {
		for _, key := range []string{"invoices/7/1-attachment.pdf", "invoices/7/payment/1-proof.pdf"} {
			if !CanWriteObject(role, BucketInvoiceAttachments, key) {
				t.Errorf("%s cannot store %q", role, key)
			}
		}
	}
}

// Buckets take their own types.
// Logos and item images are pictures; PO documents and invoice attachments
// also take PDFs and workbooks. The check ignores case.
func TestValidateAssetFileName(t *testing.T) {
	cases := []struct {
		bucket, name string
		ok           bool
	}{
		{BucketClientLogos, "logo.png", true},
		{BucketVendorLogos, "logo.JPEG", true},
		{BucketItemImages, "photo.webp", true},
		{BucketClientLogos, "logo.pdf", false},
		{BucketItemImages, "sheet.xlsx", false},
		{BucketPODocs, "scan.pdf", true},
		{BucketPODocs, "order.xls", true},
		{BucketInvoiceAttachments, "proof.PDF", true},
		{BucketInvoiceAttachments, "proof.gif", false},
		{BucketPODocs, "tool.exe", false},
		{BucketPODocs, "noextension", false},
		{BucketPODocs, "page.html", false},
		{"nonexistent-bucket", "logo.png", false},
	}
	for _, c := range cases {
		err := ValidateAssetFileName(c.bucket, c.name)
		if (err == nil) != c.ok {
			t.Errorf("ValidateAssetFileName(%q, %q) = %v, want ok=%v", c.bucket, c.name, err, c.ok)
		}
	}
}

// Documents get larger caps.
func TestMaxBytes(t *testing.T) {
	cases := []struct {
		bucket string
		want   int64
	}{
		{BucketClientLogos, 2 << 20},
		{BucketVendorLogos, 2 << 20},
		{BucketItemImages, 5 << 20},
		{BucketInvoiceAttachments, 20 << 20},
		{BucketPODocs, 20 << 20},
		{"nonexistent-bucket", 0},
	}
	for _, c := range cases {
		if got := MaxBytes(c.bucket); got != c.want {
			t.Errorf("MaxBytes(%q) = %d, want %d", c.bucket, got, c.want)
		}
	}
	for _, b := range AllBuckets {
		if MaxBytes(b) <= 0 || MaxBytes(b) > maxUploadBytes {
			t.Errorf("bucket %q cap %d is outside (0, %d]", b, MaxBytes(b), maxUploadBytes)
		}
	}
}
