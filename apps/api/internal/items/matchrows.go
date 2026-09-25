package items

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// matchChunk caps one fuzzy batch.
// One statement per chunk instead of one per row: a row-by-row match of a
// 165 row RFQ took 18 s of a 30 s request budget. The bound keeps a single
// statement short and lets later chunks see items created by earlier ones.
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
// IMPA wins, then the batched fuzzy match, then auto-create. Within one
// chunk a later row cannot fuzzy-match an item an earlier row of the same
// chunk created; the dedup key still catches an identical name.
func (m *rowMatcher) chunk(ctx context.Context, start int, rows []MatchRowInput) ([]MatchRowResult, error) {
	type pick struct {
		itemID     int64
		confidence float32
		source     string
	}
	picks := make([]pick, len(rows))
	var texts []string
	var textRow []int

	for i, row := range rows {
		if impa := normIMPA(row.IMPACode); impa != "" {
			id, err := m.repo.FindByIMPA(ctx, impa)
			switch {
			case err == nil:
				picks[i] = pick{id, 1.0, "IMPA_EXACT"}
				continue
			case !errors.Is(err, ErrNotFound):
				return nil, fmt.Errorf("match row %d by IMPA: %w", start+i, err)
			}
		}
		if strings.TrimSpace(row.Name) != "" {
			texts = append(texts, row.Name)
			textRow = append(textRow, i)
		}
	}

	fuzzy, err := m.repo.matchRequestBatch(ctx, texts)
	if err != nil {
		return nil, fmt.Errorf("match rows %d-%d by name: %w", start, start+len(rows)-1, err)
	}
	for _, f := range fuzzy {
		i := textRow[f.Idx-1] // ordinality is 1-based
		if f.Confidence >= m.minScore {
			picks[i] = pick{f.ItemID, f.Confidence, f.Source}
		}
	}

	out := make([]MatchRowResult, len(rows))
	for i, row := range rows {
		res := MatchRowResult{Index: start + i, Requested: row, Source: "NONE"}
		p := picks[i]
		if p.itemID == 0 && m.req.AutoCreate {
			id, err := m.autoCreate(ctx, row)
			if err != nil {
				return nil, fmt.Errorf("create row %d: %w", start+i, err)
			}
			if id != 0 {
				p = pick{id, 1.0, "CREATED"}
			}
		}
		if p.itemID != 0 {
			matched, err := m.repo.MatchWithVendorByID(ctx, p.itemID)
			switch {
			case err == nil:
				res.Matched, res.Confidence, res.Source = &matched, p.confidence, p.source
			case !errors.Is(err, ErrNotFound):
				return nil, fmt.Errorf("price row %d: %w", start+i, err)
			}
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
