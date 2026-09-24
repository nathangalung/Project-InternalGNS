package storage

import "testing"

func TestCanAccessBucket(t *testing.T) {
	cases := []struct {
		role, bucket string
		want         bool
	}{
		{"superadmin", BucketInvoiceAttachments, true},
		{"finance", BucketInvoiceAttachments, true},
		{"operational", BucketInvoiceAttachments, false},
		{"superadmin", BucketPODocs, true},
		{"operational", BucketPODocs, true},
		{"finance", BucketPODocs, false},
		{"operational", BucketClientLogos, true},
		{"finance", BucketItemImages, true},
		{"operational", BucketVendorLogos, true},
		{"", BucketClientLogos, false},
		{"superadmin", "nonexistent-bucket", false},
	}
	for _, c := range cases {
		if got := CanAccessBucket(c.role, c.bucket); got != c.want {
			t.Errorf("CanAccessBucket(%q, %q) = %v, want %v", c.role, c.bucket, got, c.want)
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
