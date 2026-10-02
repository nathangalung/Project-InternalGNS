package storage

import "testing"

// Part size stays small.
// minio-go refuses a part under 5 MiB and allocates one whole part per
// upload, so the bound must sit between that floor and a few parts per cap.
func TestPutPartSize(t *testing.T) {
	const minioMinPart = 5 << 20
	if putPartSize < minioMinPart {
		t.Fatalf("putPartSize = %d, below minio-go's %d floor", putPartSize, minioMinPart)
	}
	caps := map[string]int64{"default": maxUploadBytes}
	for bucket, limit := range bucketMaxBytes {
		caps[bucket] = limit
	}
	for name, limit := range caps {
		t.Run(name, func(t *testing.T) {
			if parts := (limit + putPartSize - 1) / putPartSize; parts > 2 {
				t.Fatalf("cap %d takes %d parts of %d; want at most 2", limit, parts, putPartSize)
			}
		})
	}
}
