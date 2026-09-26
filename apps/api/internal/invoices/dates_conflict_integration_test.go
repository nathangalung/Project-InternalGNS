package invoices_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Stale dates save is tagged.
// The page reloads on the code, and the stored dates stay as they were.
func TestHandler_UpdateDates_StaleVersion(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	srv := assetServer(t, tx)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	before, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)

	due := before.InvoiceDate.AddDate(0, 0, 45)
	raw, err := json.Marshal(invoices.UpdateDatesRequest{DueDate: &due})
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPatch, fmt.Sprintf("%s/invoices/%d/dates", srv.URL, invID), bytes.NewReader(raw))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Itoa(int(before.RowVersion)+5))
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()

	require.Equal(t, http.StatusConflict, res.StatusCode)
	var e httperr.Error
	require.NoError(t, json.NewDecoder(res.Body).Decode(&e))
	assert.Equal(t, httperr.VersionConflictCode, e.Code)
	assert.Equal(t, httperr.VersionConflict().Detail, e.Detail)

	after, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	assert.Equal(t, before.RowVersion, after.RowVersion)
}
