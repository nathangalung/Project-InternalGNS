package purchaseorders_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// txServer serves PO routes transactionally.
// Every row a test creates rolls back with it, so nothing reaches the
// shared database and no cleanup is needed. Requests run one at a time,
// which is all a pgx.Tx supports. Storage is the zero client: presigning
// builds a proxy path and never calls MinIO.
func txServer(t *testing.T) (context.Context, pgx.Tx, *httptest.Server) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	return ctx, tx, execServer(t, tx, "")
}

// execServer mounts routes on executors.
// A non-empty templatesRoot also mounts the delivery note route.
func execServer(t *testing.T, exec db.Executor, templatesRoot string) *httptest.Server {
	t.Helper()
	r := chi.NewRouter()
	r.Use(poInjectUser(seedUserID))
	r.Mount("/purchase-orders", purchaseorders.Routes(deps.Deps{
		Pool:          exec,
		Queries:       testutil.Store(t),
		Storage:       &storage.Client{},
		TemplatesRoot: templatesRoot,
	}))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// problem decodes RFC 7807 bodies.
// Code carries the PO lock code.
type problem struct {
	Status int               `json:"status"`
	Detail string            `json:"detail"`
	Fields map[string]string `json:"fields"`
	Code   string            `json:"code"`
}

// readProblem decodes a problem+json response.
func readProblem(t *testing.T, res *http.Response) problem {
	t.Helper()
	require.Contains(t, res.Header.Get("Content-Type"), "application/problem+json")
	var p problem
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	return p
}

// readJSON decodes a JSON response.
func readJSON(t *testing.T, res *http.Response, v any) {
	t.Helper()
	require.NoError(t, json.NewDecoder(res.Body).Decode(v))
}

// poAt walks a fresh PO.
// It reaches status through the real paths.
func poAt(t *testing.T, tx pgx.Tx, status purchaseorders.Status) (int64, int64) {
	t.Helper()
	qID, poID := acceptedQuotationWithPO(t, tx)
	reachStatus(t, tx, poID, status)
	return qID, poID
}

// reachStatus walks a PENDING PO.
// It moves forward to status.
func reachStatus(t *testing.T, tx pgx.Tx, poID int64, status purchaseorders.Status) {
	t.Helper()
	ctx := context.Background()
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	steps := map[purchaseorders.Status][]purchaseorders.Status{
		purchaseorders.StatusPending:    nil,
		purchaseorders.StatusUploaded:   {purchaseorders.StatusUploaded},
		purchaseorders.StatusOnProgress: {purchaseorders.StatusUploaded, purchaseorders.StatusOnProgress},
		purchaseorders.StatusDelivered: {
			purchaseorders.StatusUploaded, purchaseorders.StatusOnProgress, purchaseorders.StatusDelivered,
		},
		purchaseorders.StatusCancelled: {purchaseorders.StatusCancelled},
	}
	for _, s := range steps[status] {
		switch s {
		case purchaseorders.StatusUploaded:
			require.NoError(t, repo.UpdateFile(ctx, poID, ownedPOFile(poID), seedUserID))
		case purchaseorders.StatusCancelled:
			require.NoError(t, repo.Transition(ctx, poID, s, "Dibatalkan klien", seedUserID))
		default:
			require.NoError(t, repo.ChangeStatus(ctx, poID, s, seedUserID))
		}
	}
}

// ownedPOFile keys an attach payload.
// The key sits in its PO's folder.
func ownedPOFile(poID int64) purchaseorders.UpdateFileRequest {
	return purchaseorders.UpdateFileRequest{
		FileName:  "po.pdf",
		FileSize:  1024,
		ObjectKey: storage.BuildFolderKey(storage.OwnerFolder("po", poID, ""), "po.pdf"),
	}
}

// createQuotation accepts a quotation.
// It returns the quotation and PO ids.
func createQuotation(t *testing.T, tx pgx.Tx, req quotations.CreateRequest) (int64, int64) {
	t.Helper()
	ctx := context.Background()
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	qID, err := qrepo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qID, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qID, "accepted", nil, seedUserID))
	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByQuotation(ctx, qID)
	require.NoError(t, err)
	return qID, po.ID
}
