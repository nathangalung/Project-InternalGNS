package clients_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Batch lookup keeps only found ids.
func TestRepo_GetByIDs(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))
	a, err := repo.Create(ctx, clients.CreateClientRequest{Name: "PT Batch A"}, seedUserID)
	require.NoError(t, err)
	b, err := repo.Create(ctx, clients.CreateClientRequest{Name: "PT Batch B"}, seedUserID)
	require.NoError(t, err)

	got, err := repo.GetByIDs(ctx, []int64{a.ID, b.ID, 999999999})
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "PT Batch A", got[a.ID].Name)
	assert.Equal(t, "PT Batch B", got[b.ID].Name)
	assert.NotContains(t, got, int64(999999999))
}

// No ids, no query.
func TestRepo_GetByIDs_EmptySkipsQuery(t *testing.T) {
	// FakeExec fails every call, so success proves nothing ran.
	repo := clients.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	got, err := repo.GetByIDs(context.Background(), nil)
	require.NoError(t, err)
	assert.Empty(t, got)
	assert.NotNil(t, got)
}

// PUT to a taken number is 422.
func TestHandler_Update_TakenNumber(t *testing.T) {
	pool := testutil.Pool(t)
	owner := newClient(t)
	mover := newClient(t)
	var taken string
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT number FROM company_client WHERE id = $1`, owner).Scan(&taken))

	res := doJSON(t, newSrv(t), http.MethodPut, "/clients/"+itoa(mover),
		map[string]any{"name": "PT Pindah", "countryCode": "IDN", "isActive": true, "number": taken})
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	var p httperr.Error
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	assert.Equal(t, numberInvalidMsg, p.Fields["number"])
}

// A non-numeric minTotal is a 4xx.
func TestHandler_List_BadMinTotal(t *testing.T) {
	res := doJSON(t, newSrv(t), http.MethodGet, "/clients/?minTotal=banyak", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}
