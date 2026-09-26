package storage

import "testing"

// Finance reads catalog images only.
// Every other role reads and writes the same buckets.
func TestBucketAccess(t *testing.T) {
	cases := []struct {
		role, bucket string
		read, write  bool
	}{
		{"superadmin", BucketInvoiceAttachments, true, true},
		{"finance", BucketInvoiceAttachments, true, true},
		{"operational", BucketInvoiceAttachments, false, false},
		{"superadmin", BucketPODocs, true, true},
		{"operational", BucketPODocs, true, true},
		{"finance", BucketPODocs, false, false},
		{"operational", BucketClientLogos, true, true},
		{"finance", BucketClientLogos, true, true},
		{"finance", BucketItemImages, true, false},
		{"finance", BucketVendorLogos, true, false},
		{"operational", BucketItemImages, true, true},
		{"superadmin", BucketVendorLogos, true, true},
		{"", BucketClientLogos, false, false},
		{"superadmin", "nonexistent-bucket", false, false},
	}
	for _, c := range cases {
		if got := CanReadBucket(c.role, c.bucket); got != c.read {
			t.Errorf("CanReadBucket(%q, %q) = %v, want %v", c.role, c.bucket, got, c.read)
		}
		if got := CanWriteBucket(c.role, c.bucket); got != c.write {
			t.Errorf("CanWriteBucket(%q, %q) = %v, want %v", c.role, c.bucket, got, c.write)
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
