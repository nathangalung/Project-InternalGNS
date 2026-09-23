package purchaseorders_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Pairs agree with fn_change_po_status.
// Each pair runs on its own PO in a rolled-back transaction.
func TestTransitions_MatchTheDatabase(t *testing.T) {
	for _, from := range purchaseorders.StatusOrder {
		for _, to := range purchaseorders.StatusOrder {
			if from == to {
				continue
			}
			t.Run(string(from)+"-"+string(to), func(t *testing.T) {
				ctx, tx := testutil.BeginTx(t)
				_, poID := acceptedQuotationWithPO(t, tx)
				_, err := tx.Exec(ctx,
					`UPDATE purchase_orders SET status = $2, file_url = 'po/drift/1-po.pdf' WHERE id = $1`,
					poID, string(from))
				require.NoError(t, err)

				repo := purchaseorders.NewRepo(tx, testutil.Store(t))
				err = repo.Transition(ctx, poID, to, "alasan uji", seedUserID)
				if slices.ContainsFunc(purchaseorders.Transitions[from], func(m purchaseorders.Transition) bool {
					return m.To == to
				}) {
					require.NoError(t, err)
					return
				}
				assert.ErrorIs(t, err, purchaseorders.ErrInvalidTransition)
			})
		}
	}
}

func TestRepo_Cancel_RequiresReason(t *testing.T) {
	tests := []struct {
		name   string
		reason string
	}{
		{"empty", ""},
		{"blank", "   "},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))

			err := repo.Transition(ctx, poID, purchaseorders.StatusCancelled, tc.reason, seedUserID)
			var pgErr *pgconn.PgError
			require.True(t, errors.As(err, &pgErr), "want a pg error, got %v", err)
			assert.Equal(t, "P0014", pgErr.Code)
			assert.Equal(t, "Alasan pembatalan wajib diisi.", pgErr.Message)
		})
	}
}

func TestRepo_Cancel_RecordsReasonInHistory(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	require.NoError(t, repo.UpdateFile(ctx, poID, testPOFile, seedUserID))
	require.NoError(t, repo.Transition(ctx, poID, purchaseorders.StatusCancelled, "  Klien batal  ", seedUserID))

	hist, err := repo.History(ctx, poID)
	require.NoError(t, err)
	require.Len(t, hist, 3)

	assert.Nil(t, hist[0].FromStatus)
	assert.Equal(t, purchaseorders.StatusPending, hist[0].ToStatus)

	require.NotNil(t, hist[1].FromStatus)
	assert.Equal(t, purchaseorders.StatusPending, *hist[1].FromStatus)
	assert.Equal(t, purchaseorders.StatusUploaded, hist[1].ToStatus)

	last := hist[2]
	require.NotNil(t, last.FromStatus)
	assert.Equal(t, purchaseorders.StatusUploaded, *last.FromStatus)
	assert.Equal(t, purchaseorders.StatusCancelled, last.ToStatus)
	require.NotNil(t, last.Note)
	assert.Equal(t, "Klien batal", *last.Note)
	assert.Equal(t, seedUserID, last.ChangedBy)
}

func TestRepo_History_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	_, err := repo.History(ctx, 99999999)
	assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
}

func TestRepo_RemoveFile(t *testing.T) {
	tests := []struct {
		name       string
		reach      []purchaseorders.Status
		wantErr    error
		wantStatus purchaseorders.Status
	}{
		{"pending stays pending", nil, nil, purchaseorders.StatusPending},
		{"uploaded returns to pending", []purchaseorders.Status{purchaseorders.StatusUploaded}, nil, purchaseorders.StatusPending},
		{"on progress keeps the file", []purchaseorders.Status{
			purchaseorders.StatusUploaded, purchaseorders.StatusOnProgress,
		}, purchaseorders.ErrLocked, ""},
		{"cancelled keeps the file", []purchaseorders.Status{
			purchaseorders.StatusUploaded, purchaseorders.StatusCancelled,
		}, purchaseorders.ErrLocked, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))
			for _, s := range tc.reach {
				if s == purchaseorders.StatusUploaded {
					require.NoError(t, repo.UpdateFile(ctx, poID, testPOFile, seedUserID))
					continue
				}
				require.NoError(t, repo.Transition(ctx, poID, s, "alasan uji", seedUserID))
			}

			err := repo.RemoveFile(ctx, poID, seedUserID)
			if tc.wantErr != nil {
				assert.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			po, err := repo.GetByID(ctx, poID)
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, po.Status)
			assert.Nil(t, po.FileURL)
			assert.Nil(t, po.FileName)
			assert.Nil(t, po.UploadedAt)
		})
	}
}

func TestRepo_RemoveFile_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	assert.ErrorIs(t, repo.RemoveFile(ctx, 99999999, seedUserID), purchaseorders.ErrNotFound)
}

// UPLOADED needs a file.
func TestSchema_UploadedNeedsAFile(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)

	_, err := tx.Exec(ctx,
		`UPDATE purchase_orders SET status = 'UPLOADED', file_url = NULL WHERE id = $1`, poID)
	var pgErr *pgconn.PgError
	require.True(t, errors.As(err, &pgErr), "want a pg error, got %v", err)
	assert.Equal(t, "23514", pgErr.Code)
	assert.Equal(t, "purchase_orders_uploaded_has_file", pgErr.ConstraintName)
}

// Cancelled PO lines stay frozen.
func TestRepo_UpdateItems_CancelledIsLocked(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.Transition(ctx, poID, purchaseorders.StatusCancelled, "alasan uji", seedUserID))

	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct: "0",
		Items:       []purchaseorders.UpdateItemsLine{},
	}, seedUserID, nil)
	assert.ErrorIs(t, err, purchaseorders.ErrLocked)
}
