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
