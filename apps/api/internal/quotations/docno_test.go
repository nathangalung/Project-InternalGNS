package quotations_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Ids reserved for the document-number fixtures.
const (
	docNoClientA int64 = 9100001
	docNoClientB int64 = 9100002
)

// insertClient writes a client fixture and returns the insert error.
func insertClient(t *testing.T, ctx context.Context, id int64, number any) error {
	t.Helper()
	_, err := testutil.Pool(t).Exec(ctx,
		`INSERT INTO company_client (id, number, name, country_code, created_by, updated_by)
		 VALUES ($1, $2, $3, 'IDN', 1, 1)`,
		id, number, "Doc No Fixture "+string(rune('A'+id%26)))
	return err
}

// dropClients removes the fixtures and anything hanging off them.
func dropClients(t *testing.T, ids ...int64) {
	t.Helper()
	ctx := context.Background()
	pool := testutil.Pool(t)
	for _, id := range ids {
		_, _ = pool.Exec(ctx, `DELETE FROM quotation_items WHERE quotation_id IN
			(SELECT id FROM quotations WHERE company_client_id = $1)`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM quotation_status_history WHERE quotation_id IN
			(SELECT id FROM quotations WHERE company_client_id = $1)`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM quotations WHERE company_client_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM doc_sequences WHERE company_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM company_client WHERE id = $1`, id)
	}
}

// A client number is required and exactly four digits.
//
// Document numbers embed it with no delimiter, so a variable-width number
// lets two clients produce the same quotation number and permanently block
// the second one.
func TestCompanyClientNumber_FixedFourDigits(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	t.Cleanup(func() { dropClients(t, docNoClientA, docNoClientB) })

	cases := []struct {
		name    string
		number  any
		wantErr bool
	}{
		{"four digits", "0901", false},
		{"leading zeroes", "0001", false},
		{"letters", "SQA", true},
		{"letters with digit", "SQA1", true},
		{"too short", "901", true},
		{"too long", "09011", true},
		{"empty", "", true},
		{"null", nil, true},
		{"spaces", " 901", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dropClients(t, docNoClientA)
			err := insertClient(t, ctx, docNoClientA, tc.number)
			if tc.wantErr {
				require.Error(t, err, "number %v must be refused", tc.number)
				return
			}
			require.NoError(t, err)
		})
	}

	t.Run("duplicate", func(t *testing.T) {
		dropClients(t, docNoClientA, docNoClientB)
		require.NoError(t, insertClient(t, ctx, docNoClientA, "0902"))
		err := insertClient(t, ctx, docNoClientB, "0902")
		require.Error(t, err, "a client number must be unique")
	})

	var n int64
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM company_client WHERE number IS NULL OR number !~ '^[0-9]{4}$'`,
	).Scan(&n))
	assert.Zero(t, n, "every existing client must carry a four digit number after the backfill")
}

// Clients whose numbers share a prefix get distinct quotation numbers.
func TestQuotationNo_NoCollisionAcrossPrefixOverlap(t *testing.T) {
	srv, ctx := resetServer(t)
	pool := testutil.Pool(t)
	t.Cleanup(func() { dropClients(t, docNoClientA, docNoClientB) })

	dropClients(t, docNoClientA, docNoClientB)
	require.NoError(t, insertClient(t, ctx, docNoClientA, "0901"))
	require.NoError(t, insertClient(t, ctx, docNoClientB, "0911"))

	// Client A is on sequence 11, client B on sequence 1: the pair that
	// used to collapse to the same number.
	_, err := pool.Exec(ctx,
		`INSERT INTO doc_sequences (doc_type, company_id, year, last_seq, updated_at)
		 VALUES ('Q', $1, EXTRACT(YEAR FROM NOW())::INT, 10, NOW())`, docNoClientA)
	require.NoError(t, err)

	noA := createQuotationFor(t, srv, docNoClientA)
	noB := createQuotationFor(t, srv, docNoClientB)

	assert.NotEqual(t, noA, noB, "prefix-overlapping clients must not share a quotation number")
	assert.Contains(t, noA, "090111")
	assert.Contains(t, noB, "09111")
}

// createQuotationFor posts a one line draft and returns its number.
func createQuotationFor(t *testing.T, srv *httptest.Server, clientID int64) string {
	t.Helper()
	res := doJSON(t, srv, http.MethodPost, "/quotations/", createBody{
		CompanyClientID: clientID,
		DiscountPct:     "0",
		Items:           oneLine("1"),
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var body struct {
		ID int64 `json:"id"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
	return readDetail(t, srv, body.ID).QuotationNo
}
