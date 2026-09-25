package invoices_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const accessTestSecret = "invoice-access-test-secret"

// bearerFor mints a router token.
func bearerFor(t *testing.T, userID int64, role users.Role) string {
	t.Helper()
	now := time.Now()
	claims := auth.Claims{
		Role:           role,
		SessionVersion: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(accessTestSecret))
	require.NoError(t, err)
	return "Bearer " + signed
}

// Finance passes every invoice call.
// The invoice page runs on finance credentials through the real router, so
// no call it makes may need the quotation or PO subtrees.
func TestRouter_FinanceWorksTheInvoicePage(t *testing.T) {
	ctx := context.Background()
	pool := testutil.Pool(t)
	store := testutil.Store(t)

	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	qid, _, invID := deliveredPOWithInvoice(t, tx)
	require.NoError(t, tx.Commit(ctx))

	cleaner := testutil.NewCleaner(t)
	cleaner.Quotation(qid)
	userRepo := users.NewRepo(pool, store)
	ids := map[users.Role]int64{}
	for _, role := range []users.Role{users.RoleFinance, users.RoleOperational} {
		u, err := userRepo.Create(ctx, users.CreateUserRequest{
			Email:    fmt.Sprintf("inv-access-%s-%d@test.local", role, time.Now().UnixNano()),
			Name:     "Invoice access " + string(role),
			Password: "Invoice-access-pw1!",
			Role:     role,
		}, seedUserID)
		require.NoError(t, err)
		cleaner.User(u.ID)
		ids[role] = u.ID
	}
	// Runs before the user cleanup: the invoice and its
	// timeline now name finance as the editor.
	t.Cleanup(func() {
		_, err := pool.Exec(ctx, `UPDATE invoices SET updated_by = $1 WHERE id = $2`, seedUserID, invID)
		assert.NoError(t, err)
		_, err = pool.Exec(ctx, `UPDATE invoice_status_history SET changed_by = $1 WHERE invoice_id = $2`, seedUserID, invID)
		assert.NoError(t, err)
	})

	router := app.NewRouter(app.Config{
		Env:                "test",
		HTTPAddr:           ":0",
		DatabaseURL:        "ignored",
		JWTSecret:          accessTestSecret,
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"http://localhost:5173"},
	}, pool, store, nil)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	// call returns the status and body, closing the response itself.
	call := func(role users.Role, method, path string, body any, headers map[string]string) (int, []byte) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			require.NoError(t, json.NewEncoder(&buf).Encode(body))
		}
		req, err := http.NewRequest(method, srv.URL+"/api/v1"+path, &buf)
		require.NoError(t, err)
		req.Header.Set("Authorization", bearerFor(t, ids[role], role))
		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		res, err := srv.Client().Do(req)
		require.NoError(t, err)
		defer res.Body.Close()
		raw, err := io.ReadAll(res.Body)
		require.NoError(t, err)
		return res.StatusCode, raw
	}

	inv := "/invoices/" + strconv.FormatInt(invID, 10)
	code, raw := call(users.RoleFinance, http.MethodGet, "/invoices/by-quotation/"+strconv.FormatInt(qid, 10), nil, nil)
	require.Equal(t, http.StatusOK, code, string(raw))
	var det invoices.InvoiceDetail
	require.NoError(t, json.Unmarshal(raw, &det))
	require.NotNil(t, det.PoNumber, "finance gets the PO header from the invoice")

	steps := []struct {
		name    string
		method  string
		path    string
		body    any
		headers map[string]string
		want    int
	}{
		{name: "detail", method: http.MethodGet, path: inv, want: http.StatusOK},
		{name: "items", method: http.MethodGet, path: inv + "/items", want: http.StatusOK},
		{name: "dates", method: http.MethodPatch, path: inv + "/dates",
			body:    map[string]string{"dueDate": det.InvoiceDate.AddDate(0, 0, 45).Format(time.RFC3339)},
			headers: map[string]string{"If-Match": strconv.FormatInt(int64(det.RowVersion), 10)},
			want:    http.StatusOK},
		{name: "send", method: http.MethodPatch, path: inv + "/status", body: map[string]string{"status": "sent"}, want: http.StatusNoContent},
		{name: "mark paid", method: http.MethodPatch, path: inv + "/status", body: map[string]string{"status": "paid"}, want: http.StatusNoContent},
	}
	for _, st := range steps {
		code, raw := call(users.RoleFinance, st.method, st.path, st.body, st.headers)
		assert.Equal(t, st.want, code, "finance %s: %s", st.name, raw)
	}

	code, _ = call(users.RoleOperational, http.MethodGet, "/invoices/by-quotation/"+strconv.FormatInt(qid, 10), nil, nil)
	assert.Equal(t, http.StatusForbidden, code, "operational stays out of invoices")
}
