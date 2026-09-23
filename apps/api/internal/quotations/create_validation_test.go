package quotations_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Body shape accepted by POST /quotations.
type createBody struct {
	CompanyClientID int64                   `json:"companyClientId"`
	DiscountPct     string                  `json:"discountPct"`
	Status          *string                 `json:"status,omitempty"`
	Items           []quotations.CreateItem `json:"items"`
}

func oneLine(qty string) []quotations.CreateItem {
	return []quotations.CreateItem{{
		RequestedName: "PUNCHING TOOL SET",
		Qty:           qty,
		UnitID:        seedUnitID,
		SellingPrice:  "1500000",
	}}
}

func countQuotations(t *testing.T) int64 {
	t.Helper()
	var n int64
	err := testutil.Pool(t).QueryRow(t.Context(), "SELECT COUNT(*) FROM quotations").Scan(&n)
	require.NoError(t, err)
	return n
}

// POST rejects any status but draft and inserts nothing.
func TestHandler_Create_RejectsNonDraftStatus(t *testing.T) {
	srv, _ := resetServer(t)

	cases := []struct {
		name   string
		status *string
		want   int
	}{
		{"accepted", strPtr("accepted"), http.StatusUnprocessableEntity},
		{"sent", strPtr("sent"), http.StatusUnprocessableEntity},
		{"garbage", strPtr("bukan-status"), http.StatusUnprocessableEntity},
		{"draft", strPtr("draft"), http.StatusCreated},
		{"empty", strPtr(""), http.StatusCreated},
		{"absent", nil, http.StatusCreated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := countQuotations(t)
			res := doJSON(t, srv, http.MethodPost, "/quotations/", createBody{
				CompanyClientID: seedCompanyID,
				DiscountPct:     "0",
				Status:          tc.status,
				Items:           oneLine("1"),
			})
			defer res.Body.Close()
			assert.Equal(t, tc.want, res.StatusCode)

			after := countQuotations(t)
			if tc.want == http.StatusCreated {
				assert.Equal(t, before+1, after, "created quotation must be stored")
				var body struct {
					ID int64 `json:"id"`
				}
				require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
				d := readDetail(t, srv, body.ID)
				assert.Equal(t, "draft", d.Status)
				return
			}
			assert.Equal(t, before, after, "rejected create must insert no row")
		})
	}
}

// Zero or negative quantity lines are refused.
func TestHandler_Create_RejectsZeroQtyLine(t *testing.T) {
	srv, _ := resetServer(t)

	cases := []struct {
		name string
		qty  string
		want int
	}{
		{"zero", "0", http.StatusUnprocessableEntity},
		{"zero with decimals", "0.00", http.StatusUnprocessableEntity},
		{"negative", "-1", http.StatusUnprocessableEntity},
		{"blank", "", http.StatusUnprocessableEntity},
		{"positive", "1", http.StatusCreated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := countQuotations(t)
			res := doJSON(t, srv, http.MethodPost, "/quotations/", createBody{
				CompanyClientID: seedCompanyID,
				DiscountPct:     "0",
				Items:           oneLine(tc.qty),
			})
			defer res.Body.Close()
			assert.Equal(t, tc.want, res.StatusCode)
			if tc.want != http.StatusCreated {
				assert.Equal(t, before, countQuotations(t), "rejected create must insert no row")
			}
		})
	}
}

// The database refuses a zero quantity line too.
func TestQuotationItems_QtyCheckConstraint(t *testing.T) {
	srv, ctx := resetServer(t)
	res := doJSON(t, srv, http.MethodPost, "/quotations/", createBody{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items:           oneLine("1"),
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var body struct {
		ID int64 `json:"id"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))

	_, err := testutil.Pool(t).Exec(ctx,
		"UPDATE quotation_items SET qty = 0 WHERE quotation_id = $1 AND item_type = 'product'", body.ID)
	require.Error(t, err, "qty 0 must violate a check constraint")
	assert.Contains(t, err.Error(), "qty")
}

func strPtr(s string) *string { return &s }

func readDetail(t *testing.T, srv *httptest.Server, id int64) quotations.QuotationDetail {
	t.Helper()
	res := doJSON(t, srv, http.MethodGet, "/quotations/"+strconv.FormatInt(id, 10), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var d quotations.QuotationDetail
	require.NoError(t, json.NewDecoder(res.Body).Decode(&d))
	return d
}
