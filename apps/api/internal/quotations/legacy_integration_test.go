package quotations_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Old numbers answer typed text.
// A re-imported quotation is found and read by the number it was first
// issued under; a period search reads only the current number, and a
// revision starts without the old one.
func TestLegacyNo_SearchReadRevise(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	legacy := "Q-26" + tag + "/GNS/X/1998"
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE quotations SET legacy_no = $2 WHERE id = $1`, id, legacy)
	require.NoError(t, err)

	det, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, &legacy, det.LegacyNo)

	for _, tc := range []struct {
		q     string
		found bool
	}{
		{"26" + tag, true},
		{legacy, true},
		{"10/1998", false},
		{"X/1998", false},
	} {
		res, err := repo.List(ctx, quotations.ListFilter{Q: tc.q, Limit: 100})
		require.NoError(t, err)
		var row *quotations.ListRow
		for i := range res.Rows {
			if res.Rows[i].ID == id {
				row = &res.Rows[i]
			}
		}
		if !tc.found {
			assert.Nil(t, row, "%q must not find the old number", tc.q)
			continue
		}
		require.NotNil(t, row, "%q must find the old number", tc.q)
		assert.Equal(t, &legacy, row.LegacyNo)
	}

	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
	rev, err := repo.Revise(ctx, id, nil, seedUserID)
	require.NoError(t, err)
	revised, err := repo.GetDetail(ctx, rev)
	require.NoError(t, err)
	assert.Nil(t, revised.LegacyNo, "a revision is a new issue, not the imported one")
}

// The API never writes it.
// A create naming legacyNo stores none, and the response omits the field.
func TestLegacyNo_NotWritable(t *testing.T) {
	srv, _ := resetServer(t)
	body := map[string]any{
		"companyClientId": seedCompanyID,
		"discountPct":     "0",
		"legacyNo":        "Q-PALSU/GNS/I/2020",
		"items":           oneLine("1"),
	}
	res := doJSON(t, srv, http.MethodPost, "/quotations/", body)
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var created struct {
		ID int64 `json:"id"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&created))

	var stored *string
	require.NoError(t, testutil.Pool(t).QueryRow(t.Context(),
		`SELECT legacy_no FROM quotations WHERE id = $1`, created.ID).Scan(&stored))
	assert.Nil(t, stored)

	detail := doJSON(t, srv, http.MethodGet, "/quotations/"+strconv.FormatInt(created.ID, 10), nil)
	defer detail.Body.Close()
	var raw map[string]any
	require.NoError(t, json.NewDecoder(detail.Body).Decode(&raw))
	assert.NotContains(t, raw, "legacyNo")
}
