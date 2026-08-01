package items

import (
	"sort"
	"strings"
)

// tierWeight ranks tiers; higher = better.
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

// classify maps item match_tier→canonical advanced tier.
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

func mergeAdvanced(q string, items []SearchResult, offers []VendorOfferHit, requests []RequestHistoryHit, limit int) AdvancedSearchResponse {
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
	if len(out) > limit {
		out = out[:limit]
	}

	// Count tiers from the final, deduplicated, truncated output so badge
	// counts reflect what is actually returned (each item by its winning
	// tier only — not per input contribution before truncation).
	for i := range out {
		counts[out[i].Tier]++
	}

	return AdvancedSearchResponse{
		Query:  q,
		Total:  len(out),
		Hits:   out,
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

// autoCreateKey dedups import rows: impa wins, else normalized name.
func autoCreateKey(impa, name string) string {
	if impa != "" {
		return "impa:" + impa
	}
	return "name:" + strings.ToLower(strings.Join(strings.Fields(name), " "))
}
