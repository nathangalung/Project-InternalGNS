package items

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// matchChunk caps one lookup batch.
// One statement per chunk instead of one per row: a row-by-row match of a
// 165 row RFQ took 18 s of a 30 s request budget. The IMPA, name and price
// lookups all run per chunk. The bound keeps a single statement short and
// lets later chunks see items created by earlier ones.
const matchChunk = 100

// ErrNoTx: executor cannot begin transactions.
var ErrNoTx = errors.New("items: executor cannot begin a transaction")

// batchMatch is a best match.
type batchMatch struct {
	Idx        int64   `db:"idx"`
	ItemID     int64   `db:"item_id"`
	Confidence float32 `db:"confidence"`
	Source     string  `db:"source"`
}

// MatchRows resolves one import atomically.
// Auto-create writes a catalog row per unmatched line, so any failure rolls
// back every earlier create and a retry of the same file cannot duplicate
// them. Under a caller's transaction this is a savepoint.
func (r *Repo) MatchRows(ctx context.Context, req MatchRowsRequest, minScore float32, userID int64) ([]MatchRowResult, error) {
	b, ok := r.db.(db.TxBeginner)
	if !ok {
		return nil, ErrNoTx
	}
	var out []MatchRowResult
	err := db.WithTx(ctx, b, func(tx pgx.Tx) error {
		m := &rowMatcher{repo: r.WithExec(tx), req: req, minScore: minScore, userID: userID,
			created: map[string]int64{}}
		var err error
		out, err = m.run(ctx)
		return err
	})
	return out, err
}

// rowMatcher carries one import's state.
type rowMatcher struct {
	repo     *Repo
	req      MatchRowsRequest
	minScore float32
	userID   int64
	// created dedups auto-created rows.
	// Keyed by IMPA or normalised name, across chunks.
	created map[string]int64
}

func (m *rowMatcher) run(ctx context.Context) ([]MatchRowResult, error) {
	out := make([]MatchRowResult, 0, len(m.req.Rows))
	for start := 0; start < len(m.req.Rows); start += matchChunk {
		end := min(start+matchChunk, len(m.req.Rows))
		chunk, err := m.chunk(ctx, start, m.req.Rows[start:end])
		if err != nil {
			return nil, err
		}
		out = append(out, chunk...)
	}
	return out, nil
}

// chunk matches a row slice.
// IMPA wins, then the batched fuzzy match, then auto-create, then one price
// lookup for every picked item. Each lookup is one statement per chunk and
// only auto-create writes row by row. Within one chunk a later row cannot
// match an item an earlier row of the same chunk created, by IMPA or by
// name; the dedup key still catches an identical code or name, and a later
// chunk sees the item.
func (m *rowMatcher) chunk(ctx context.Context, start int, rows []MatchRowInput) ([]MatchRowResult, error) {
	type pick struct {
		itemID     int64
		confidence float32
		source     string
	}
	picks := make([]pick, len(rows))
	last := start + len(rows) - 1

	var codes []string
	var codeRow []int
	for i, row := range rows {
		if impa := normIMPA(row.IMPACode); impa != "" {
			codes = append(codes, impa)
			codeRow = append(codeRow, i)
		}
	}
	hits, err := m.repo.findByIMPABatch(ctx, codes)
	if err != nil {
		return nil, fmt.Errorf("match rows %d-%d by IMPA: %w", start, last, err)
	}
	for _, h := range hits {
		picks[codeRow[h.Idx-1]] = pick{h.ItemID, 1.0, "IMPA_EXACT"} // ordinality is 1-based
	}

	var texts []string
	var textRow []int
	for i, row := range rows {
		if picks[i].itemID == 0 && strings.TrimSpace(row.Name) != "" {
			texts = append(texts, row.Name)
			textRow = append(textRow, i)
		}
	}
	fuzzy, err := m.repo.matchRequestBatch(ctx, texts)
	if err != nil {
		return nil, fmt.Errorf("match rows %d-%d by name: %w", start, last, err)
	}
	for _, f := range fuzzy {
		i := textRow[f.Idx-1]
		if f.Confidence >= m.minScore {
			picks[i] = pick{f.ItemID, f.Confidence, f.Source}
		}
	}

	if m.req.AutoCreate {
		for i, row := range rows {
			if picks[i].itemID != 0 {
				continue
			}
			id, err := m.autoCreate(ctx, row)
			if err != nil {
				return nil, fmt.Errorf("create row %d: %w", start+i, err)
			}
			if id != 0 {
				picks[i] = pick{id, 1.0, "CREATED"}
			}
		}
	}

	ids := make([]int64, 0, len(rows))
	seen := make(map[int64]bool, len(rows))
	for _, p := range picks {
		if p.itemID != 0 && !seen[p.itemID] {
			seen[p.itemID] = true
			ids = append(ids, p.itemID)
		}
	}
	priced, err := m.repo.matchWithVendorBatch(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("price rows %d-%d: %w", start, last, err)
	}

	out := make([]MatchRowResult, len(rows))
	for i, row := range rows {
		res := MatchRowResult{Index: start + i, Requested: row, Source: "NONE"}
		p := picks[i]
		// An inactive item has no price row and stays unmatched.
		if matched, ok := priced[p.itemID]; ok {
			res.Matched, res.Confidence, res.Source = &matched, p.confidence, p.source
		}
		out[i] = res
	}
	return out, nil
}

// autoCreate adds catalog items once.
// Returns 0 for a row with no name to create from.
func (m *rowMatcher) autoCreate(ctx context.Context, row MatchRowInput) (int64, error) {
	name := strings.TrimSpace(row.Name)
	if name == "" {
		return 0, nil
	}
	impa := normIMPA(row.IMPACode)
	key := autoCreateKey(impa, name)
	if id, ok := m.created[key]; ok {
		return id, nil
	}
	var impaPtr *string
	if impa != "" {
		impaPtr = &impa
	}
	it, err := m.repo.Create(ctx, CreateItemRequest{Name: name, IMPACode: impaPtr}, m.userID)
	if err != nil {
		return 0, err
	}
	m.created[key] = it.ID
	return it.ID, nil
}

// impaHit is an exact code match.
type impaHit struct {
	Idx    int64 `db:"idx"`
	ItemID int64 `db:"item_id"`
}

// findByIMPABatch resolves codes at once.
// CollectRows reads the stream to its end, so a broken result is an error
// and never a miss that would auto-create a duplicate.
func (r *Repo) findByIMPABatch(ctx context.Context, codes []string) ([]impaHit, error) {
	if len(codes) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, r.store.Get("items.find_by_impa_bulk"), codes)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[impaHit])
}

// matchWithVendorBatch prices items at once.
// Keyed by item id; an inactive or missing item has no entry.
func (r *Repo) matchWithVendorBatch(ctx context.Context, ids []int64) (map[int64]MatchedItemWithVendor, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, r.store.Get("items.match_with_vendor_by_ids"), ids)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByName[MatchedItemWithVendor])
	if err != nil {
		return nil, err
	}
	out := make(map[int64]MatchedItemWithVendor, len(list))
	for _, m := range list {
		out[m.ItemID] = m
	}
	return out, nil
}

// matchRequestBatch fuzzy-matches texts at once.
func (r *Repo) matchRequestBatch(ctx context.Context, texts []string) ([]batchMatch, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, r.store.Get("items.match_request_batch"), texts)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[batchMatch])
}

// normIMPA mirrors the SQL normalisation.
func normIMPA(code string) string {
	return strings.ToUpper(strings.TrimSpace(code))
}
