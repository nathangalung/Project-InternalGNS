package items

import (
	"sort"
	"strings"
)

// tierWeight ranks tiers, higher better.
func tierWeight(tier string) float32 {
	switch tier {
	case "ITEM_AUTO":
		return 5.0
	case "VENDOR_OFFER":
		return 4.0
	case "ITEM_SUGGESTED":
		return 3.0
	case "REQUEST_HISTORY":
		return 2.0
	case "ITEM_FUZZY":
		return 1.0
	default:
		return 0
	}
}

// classifyItem maps to advanced tiers.
// It turns an item match_tier into the canonical advanced tier.
func classifyItem(t string) string {
	switch t {
	case "AUTO_MATCH":
		return "ITEM_AUTO"
	case "SUGGESTED":
		return "ITEM_SUGGESTED"
	default:
		return "ITEM_FUZZY"
	}
}

// candidateItemIDs collects distinct layer ids.
// Every item id the three layers produced appears once.
func candidateItemIDs(items []SearchResult, offers []VendorOfferHit, requests []RequestHistoryHit) []int64 {
	seen := map[int64]struct{}{}
	out := make([]int64, 0, len(items)+len(offers)+len(requests))
	add := func(id int64) {
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	for _, it := range items {
		add(it.ID)
	}
	for _, o := range offers {
		add(o.ItemID)
	}
	for _, rq := range requests {
		add(rq.ItemID)
	}
	return out
}

// mergeAdvanced ranks and pages hits.
// It dedups the three search layers into tier-ranked hits and returns the
// page at offset. meta carries the real is_active and catalog identity per
// item id; onlyActive, when set, keeps just the hits matching it.
// Total and counts cover every match after that filter, not only the page, so
// they stay put while the caller pages.
func mergeAdvanced(q string, items []SearchResult, offers []VendorOfferHit, requests []RequestHistoryHit, meta map[int64]ItemMeta, onlyActive *bool, limit, offset int) AdvancedSearchResponse {
	hits := map[int64]*AdvancedSearchHit{}
	counts := map[string]int{}

	upsert := func(id int64, tier string, score float32, enrich func(*AdvancedSearchHit)) {
		h, ok := hits[id]
		if !ok {
			h = &AdvancedSearchHit{ID: id, Score: score, Tier: tier, Tiers: []string{tier}}
			hits[id] = h
		} else {
			if !contains(h.Tiers, tier) {
				h.Tiers = append(h.Tiers, tier)
			}
			if tierWeight(tier) > tierWeight(h.Tier) ||
				(tierWeight(tier) == tierWeight(h.Tier) && score > h.Score) {
				h.Tier = tier
				h.Score = score
			}
		}
		if enrich != nil {
			enrich(h)
		}
	}

	for _, it := range items {
		tier := classifyItem(it.MatchTier)
		upsert(it.ID, tier, it.Score, func(h *AdvancedSearchHit) {
			if h.Name == "" {
				h.Name = it.Name
				h.IMPACode = it.IMPACode
				h.DefaultUnitID = it.DefaultUnitID
			}
		})
	}
	for _, o := range offers {
		vid := o.VendorID
		vname := o.VendorName
		sku := o.VendorSKU
		upsert(o.ItemID, "VENDOR_OFFER", o.Score, func(h *AdvancedSearchHit) {
			if h.VendorID == nil {
				h.VendorID = &vid
				h.VendorName = &vname
				h.VendorSKU = sku
			}
		})
	}
	for _, rq := range requests {
		txt := rq.RequestText
		upsert(rq.ItemID, "REQUEST_HISTORY", rq.Score, func(h *AdvancedSearchHit) {
			if h.RequestText == nil {
				h.RequestText = &txt
			}
		})
	}

	out := make([]AdvancedSearchHit, 0, len(hits))
	for _, h := range hits {
		// A missing id means the item row is gone; treat it as inactive so a
		// stale vendor-offer or request-history hit never claims to be active.
		m := meta[h.ID]
		h.IsActive = m.Active
		// The item loop only enriches fuzzy/suggested/auto hits, so a
		// vendor-offer- or history-only hit reaches here nameless; backfill its
		// catalog identity from meta.
		if h.Name == "" {
			h.Name = m.Name
			if h.IMPACode == nil {
				h.IMPACode = m.IMPACode
			}
			if h.DefaultUnitID == nil {
				h.DefaultUnitID = m.DefaultUnitID
			}
		}
		if onlyActive != nil && h.IsActive != *onlyActive {
			continue
		}
		out = append(out, *h)
	}
	sort.SliceStable(out, func(i, j int) bool {
		wi, wj := tierWeight(out[i].Tier), tierWeight(out[j].Tier)
		if wi != wj {
			return wi > wj
		}
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].ID < out[j].ID
	})

	// Each item counts once, under its winning tier.
	for i := range out {
		counts[out[i].Tier]++
	}

	start := min(offset, len(out))
	end := min(start+limit, len(out))
	return AdvancedSearchResponse{
		Query:  q,
		Total:  len(out),
		Hits:   out[start:end:end],
		Counts: counts,
	}
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

// autoCreateKey dedups import rows.
// IMPA wins, else the normalized name.
func autoCreateKey(impa, name string) string {
	if impa != "" {
		return "impa:" + impa
	}
	return "name:" + strings.ToLower(strings.Join(strings.Fields(name), " "))
}
