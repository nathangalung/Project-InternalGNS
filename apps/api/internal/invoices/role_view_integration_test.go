package invoices_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// roleServer mounts invoices as role.
func roleServer(t *testing.T, tx pgx.Tx, role string) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := deps.WithUserRole(deps.WithUserID(req.Context(), seedUserID), role)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/invoices", invoices.Routes(deps.Deps{Pool: tx, Queries: testutil.Store(t), Objects: testutil.StoredObjects{}}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

func getJSON[T any](t *testing.T, srv *httptest.Server, path string) T {
	t.Helper()
	res, err := srv.Client().Get(srv.URL + path)
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var v T
	require.NoError(t, json.NewDecoder(res.Body).Decode(&v))
	return v
}

// Finance input bills and collects.
// It reads the billed figures without harga beli, is offered Lunas only,
// issues no Pengganti and is refused any other move.
func TestHandler_InvoiceByRole(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	qid, _ := deliveredPOWithVessel(t, tx)
	inv, err := invoices.NewRepo(tx, testutil.Store(t)).GetDetailByQuotation(context.Background(), qid)
	require.NoError(t, err)

	for _, tt := range []struct {
		role  string
		cost  bool
		moves []string
	}{
		{roles.Finance, true, []string{"sent", "cancelled"}},
		{roles.FinanceInput, false, []string{}},
	} {
		t.Run(tt.role, func(t *testing.T) {
			srv := roleServer(t, tx, tt.role)
			d := getJSON[map[string]any](t, srv, fmt.Sprintf("/invoices/%d", inv.ID))
			assert.Contains(t, d, "total", "billed figures stay")
			offered := d["allowedTransitions"].([]any)
			moves := make([]string, 0, len(offered))
			for _, m := range offered {
				moves = append(moves, m.(map[string]any)["to"].(string))
			}
			assert.ElementsMatch(t, tt.moves, moves)
			lines := getJSON[[]map[string]any](t, srv, fmt.Sprintf("/invoices/%d/items", inv.ID))
			require.NotEmpty(t, lines)
			for _, l := range lines {
				assert.Contains(t, l, "unitPrice")
				assert.Equal(t, tt.cost, l["costPrice"] != nil, "costPrice")
			}
		})
	}

	srv := roleServer(t, tx, roles.FinanceInput)
	req, err := http.NewRequest(http.MethodPatch, fmt.Sprintf("%s/invoices/%d/status", srv.URL, inv.ID),
		strings.NewReader(`{"status":"sent"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	res.Body.Close()
	assert.Equal(t, http.StatusForbidden, res.StatusCode, "only Lunas")
}

// Finance input may collect.
// A sent invoice offers finance input Lunas alone, never Batalkan, while
// the finance head keeps both.
func TestHandler_SentInvoiceMovesByRole(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)
	_, err := tx.Exec(ctx, `SELECT fn_change_invoice_status($1, 'sent', $2, NULL, NULL)`, invID, seedUserID)
	require.NoError(t, err)

	for _, tt := range []struct {
		role  string
		moves []string
	}{
		{roles.Finance, []string{"paid", "cancelled"}},
		{roles.FinanceInput, []string{"paid"}},
	} {
		t.Run(tt.role, func(t *testing.T) {
			d := getJSON[map[string]any](t, roleServer(t, tx, tt.role), fmt.Sprintf("/invoices/%d", invID))
			allowed := d["allowedTransitions"].([]any)
			moves := make([]string, 0, len(allowed))
			for _, m := range allowed {
				moves = append(moves, m.(map[string]any)["to"].(string))
			}
			assert.ElementsMatch(t, tt.moves, moves)
		})
	}
}
