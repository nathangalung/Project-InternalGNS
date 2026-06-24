package items

import "testing"

// A single item surfaced by both fuzzy search and a vendor offer must be
// counted once, under its winning (higher-weight) tier — not once per source.
func TestMergeAdvanced_CountsByWinningTierNotInput(t *testing.T) {
	items := []SearchResult{{ID: 42, Name: "Pump", Score: 0.5, MatchTier: "FUZZY"}}
	offers := []VendorOfferHit{{ItemID: 42, VendorID: 7, VendorName: "Acme", Score: 0.9}}

	resp := mergeAdvanced("pump", items, offers, nil, 20)

	if resp.Total != 1 {
		t.Fatalf("Total = %d, want 1 (same item deduped)", resp.Total)
	}
	if resp.Counts["VENDOR_OFFER"] != 1 {
		t.Errorf("VENDOR_OFFER count = %d, want 1", resp.Counts["VENDOR_OFFER"])
	}
	if resp.Counts["ITEM_FUZZY"] != 0 {
		t.Errorf("ITEM_FUZZY count = %d, want 0 (superseded by vendor offer)", resp.Counts["ITEM_FUZZY"])
	}
}

// Counts must reflect the truncated output, not everything seen pre-limit.
func TestMergeAdvanced_CountsAfterTruncation(t *testing.T) {
	items := make([]SearchResult, 5)
	for i := range items {
		items[i] = SearchResult{ID: int64(i + 1), Name: "x", Score: 0.5, MatchTier: "FUZZY"}
	}
	resp := mergeAdvanced("x", items, nil, nil, 3)

	if resp.Total != 3 {
		t.Fatalf("Total = %d, want 3 (limit)", resp.Total)
	}
	if resp.Counts["ITEM_FUZZY"] != 3 {
		t.Errorf("ITEM_FUZZY count = %d, want 3 (matches returned, not the 5 seen)", resp.Counts["ITEM_FUZZY"])
	}
}
