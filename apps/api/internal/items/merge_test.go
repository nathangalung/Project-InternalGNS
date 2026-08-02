package items

import "testing"

// A single item surfaced by both fuzzy search and a vendor offer must be
// counted once, under its winning (higher-weight) tier — not once per source.
func TestMergeAdvanced_CountsByWinningTierNotInput(t *testing.T) {
	items := []SearchResult{{ID: 42, Name: "Pump", Score: 0.5, MatchTier: "FUZZY"}}
	offers := []VendorOfferHit{{ItemID: 42, VendorID: 7, VendorName: "Acme", Score: 0.9}}

	resp := mergeAdvanced("pump", items, offers, nil, map[int64]ItemMeta{42: {Active: true}}, nil, 20)

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
	active := map[int64]ItemMeta{1: {Active: true}, 2: {Active: true}, 3: {Active: true}, 4: {Active: true}, 5: {Active: true}}
	resp := mergeAdvanced("x", items, nil, nil, active, nil, 3)

	if resp.Total != 3 {
		t.Fatalf("Total = %d, want 3 (limit)", resp.Total)
	}
	if resp.Counts["ITEM_FUZZY"] != 3 {
		t.Errorf("ITEM_FUZZY count = %d, want 3 (matches returned, not the 5 seen)", resp.Counts["ITEM_FUZZY"])
	}
}

// A deactivated item reachable only through the vendor-offer layer must report
// its real flag, not the caller's filter selection.
func TestMergeAdvanced_IsActiveFromCatalogNotFilter(t *testing.T) {
	offers := []VendorOfferHit{
		{ItemID: 10, VendorID: 1, VendorName: "Acme", Score: 0.9},
		{ItemID: 11, VendorID: 1, VendorName: "Acme", Score: 0.8},
	}
	active := map[int64]ItemMeta{10: {Active: true}, 11: {Active: false}}

	resp := mergeAdvanced("acme", nil, offers, nil, active, nil, 20)

	if resp.Total != 2 {
		t.Fatalf("Total = %d, want 2", resp.Total)
	}
	got := map[int64]bool{}
	for _, h := range resp.Hits {
		got[h.ID] = h.IsActive
	}
	if !got[10] {
		t.Errorf("hit 10 IsActive = false, want true")
	}
	if got[11] {
		t.Errorf("hit 11 IsActive = true, want false (deactivated item)")
	}
}

// An id with no catalog row is inactive, never a fabricated "active".
func TestMergeAdvanced_MissingCatalogRowIsInactive(t *testing.T) {
	requests := []RequestHistoryHit{{ItemID: 99, RequestText: "bearing", Score: 0.7}}

	resp := mergeAdvanced("bearing", nil, nil, requests, map[int64]ItemMeta{}, nil, 20)

	if len(resp.Hits) != 1 {
		t.Fatalf("Hits = %d, want 1", len(resp.Hits))
	}
	if resp.Hits[0].IsActive {
		t.Error("IsActive = true for an id with no catalog row, want false")
	}
}

// onlyActive filters before the limit and the counts, so hits, total and
// counts all agree.
func TestMergeAdvanced_OnlyActiveFilterKeepsCountsConsistent(t *testing.T) {
	items := []SearchResult{
		{ID: 1, Name: "a", Score: 0.5, MatchTier: "FUZZY"},
		{ID: 2, Name: "b", Score: 0.5, MatchTier: "FUZZY"},
	}
	offers := []VendorOfferHit{{ItemID: 3, VendorID: 1, VendorName: "Acme", Score: 0.9}}
	active := map[int64]ItemMeta{1: {Active: true}, 2: {Active: false}, 3: {Active: false}}

	inactive := false
	resp := mergeAdvanced("q", items, offers, nil, active, &inactive, 20)

	if resp.Total != 2 {
		t.Fatalf("Total = %d, want 2 (only the inactive items)", resp.Total)
	}
	if resp.Counts["ITEM_FUZZY"] != 1 || resp.Counts["VENDOR_OFFER"] != 1 {
		t.Errorf("counts = %v, want one ITEM_FUZZY and one VENDOR_OFFER", resp.Counts)
	}
	for _, h := range resp.Hits {
		if h.IsActive {
			t.Errorf("hit %d IsActive = true, want false under isActive=false", h.ID)
		}
	}
}

func TestCandidateItemIDs_DedupsAcrossLayers(t *testing.T) {
	ids := candidateItemIDs(
		[]SearchResult{{ID: 1}, {ID: 2}},
		[]VendorOfferHit{{ItemID: 2}, {ItemID: 3}},
		[]RequestHistoryHit{{ItemID: 3}, {ItemID: 4}},
	)
	if len(ids) != 4 {
		t.Fatalf("ids = %v, want 4 distinct", ids)
	}
}
