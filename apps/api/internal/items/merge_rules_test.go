package items

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Tier order drives the ranking.
func TestTierWeight_Order(t *testing.T) {
	order := []string{"ITEM_AUTO", "VENDOR_OFFER", "ITEM_SUGGESTED", "REQUEST_HISTORY", "ITEM_FUZZY", "UNKNOWN"}
	for i := 1; i < len(order); i++ {
		assert.Greater(t, tierWeight(order[i-1]), tierWeight(order[i]), "%s over %s", order[i-1], order[i])
	}
	assert.Zero(t, tierWeight("UNKNOWN"))
}

func TestClassifyItem(t *testing.T) {
	cases := []struct{ in, want string }{
		{"AUTO_MATCH", "ITEM_AUTO"},
		{"SUGGESTED", "ITEM_SUGGESTED"},
		{"FUZZY", "ITEM_FUZZY"},
		{"", "ITEM_FUZZY"},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, classifyItem(c.in), c.in)
	}
}

// Import dedup keys.
func TestAutoCreateKey(t *testing.T) {
	cases := []struct {
		name, impa, row, want string
	}{
		{"impa wins over name", "ZT1", "Baut", "impa:ZT1"},
		{"name folds case", "", "Baut Besi", "name:baut besi"},
		{"name folds spacing", "", "  Baut \t Besi  ", "name:baut besi"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, autoCreateKey(c.impa, c.row))
		})
	}
	assert.Equal(t, autoCreateKey("", "BAUT  besi"), autoCreateKey("", "baut besi"))
}

// A weaker tier never demotes a hit.
func TestMergeAdvanced_KeepsStrongestTier(t *testing.T) {
	items := []SearchResult{{ID: 7, Name: "Baut", Score: 0.4, MatchTier: "FUZZY"}}
	offers := []VendorOfferHit{{ItemID: 7, VendorID: 3, VendorName: "CV Baut", Score: 0.6}}
	requests := []RequestHistoryHit{{ItemID: 7, RequestText: "baut m8", Score: 0.9}}
	meta := map[int64]ItemMeta{7: {Active: true, Name: "Baut"}}

	resp := mergeAdvanced("baut", items, offers, requests, meta, nil, 10, 0)
	if assert.Len(t, resp.Hits, 1) {
		h := resp.Hits[0]
		assert.Equal(t, "VENDOR_OFFER", h.Tier)
		assert.InDelta(t, 0.6, h.Score, 1e-6)
		assert.ElementsMatch(t, []string{"ITEM_FUZZY", "VENDOR_OFFER", "REQUEST_HISTORY"}, h.Tiers)
		assert.Equal(t, "Baut", h.Name)
		assert.Equal(t, "baut m8", *h.RequestText)
	}
	assert.Equal(t, map[string]int{"VENDOR_OFFER": 1}, resp.Counts)
}

// Two offers list their tier once.
func TestMergeAdvanced_RepeatedTierListedOnce(t *testing.T) {
	offers := []VendorOfferHit{
		{ItemID: 9, VendorID: 1, VendorName: "CV Satu", Score: 0.5},
		{ItemID: 9, VendorID: 2, VendorName: "CV Dua", Score: 0.8},
	}
	resp := mergeAdvanced("baut", nil, offers, nil, map[int64]ItemMeta{9: {Active: true, Name: "Baut"}}, nil, 10, 0)
	if assert.Len(t, resp.Hits, 1) {
		h := resp.Hits[0]
		assert.Equal(t, []string{"VENDOR_OFFER"}, h.Tiers)
		assert.InDelta(t, 0.8, h.Score, 1e-6, "the better offer's score wins")
		assert.Equal(t, "CV Satu", *h.VendorName, "the first offer names the vendor")
	}
}
