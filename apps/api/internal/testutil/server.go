package testutil

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/countries"
	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// Store loads queries from disk.
func Store(t testing.TB) queries.Store {
	t.Helper()
	s, err := queries.Load()
	if err != nil {
		t.Fatalf("queries.Load: %v", err)
	}
	return s
}

// Inject user id into ctx.
func withUserID(userID int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := deps.WithUserID(req.Context(), userID)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}
}

// QuotationServer wires routes for ATDD.
func QuotationServer(t testing.TB, userID int64) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	r.Mount("/quotations", quotations.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// ClientsServer wires clients routes.
func ClientsServer(t testing.TB, userID int64) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	r.Mount("/clients", clients.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// ItemsServer wires items routes.
func ItemsServer(t testing.TB, userID int64) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	r.Mount("/items", items.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// VendorsServer wires vendors routes.
func VendorsServer(t testing.TB, userID int64) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	r.Mount("/vendors", vendors.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// UnitsServer wires units routes.
func UnitsServer(t testing.TB) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Mount("/units", units.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// CountriesServer wires countries routes.
func CountriesServer(t testing.TB) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Mount("/countries", countries.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// DashboardServer wires dashboard routes.
func DashboardServer(t testing.TB) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Mount("/dashboard", dashboard.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// PurchaseOrdersServer wires PO routes.
func PurchaseOrdersServer(t testing.TB, userID int64) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	r.Mount("/purchase-orders", purchaseorders.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// InvoicesServer wires invoice routes.
func InvoicesServer(t testing.TB, userID int64) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	r.Mount("/invoices", invoices.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// UsersServer wires user routes.
func UsersServer(t testing.TB, userID int64) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	r.Mount("/users", users.Routes(deps.Deps{Pool: pool, Queries: store}))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// FullServer wires quotation, PO, and invoice routes.
func FullServer(t testing.TB, userID int64) *httptest.Server {
	t.Helper()
	pool := Pool(t)
	store := Store(t)
	d := deps.Deps{Pool: pool, Queries: store}

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	r.Mount("/quotations", quotations.Routes(d))
	r.Mount("/purchase-orders", purchaseorders.Routes(d))
	r.Mount("/invoices", invoices.Routes(d))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// FaultyServer mounts routes against FakeExec.
func FaultyServer(t testing.TB, userID int64, mount func(chi.Router, deps.Deps)) *httptest.Server {
	t.Helper()
	store := Store(t)
	d := deps.Deps{Pool: FakeExec{}, Queries: store}

	r := chi.NewRouter()
	r.Use(withUserID(userID))
	mount(r, d)

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv
}

// ResetQuotationDomain truncates quotation* rows.
func ResetQuotationDomain(ctx context.Context, exec quotations.Executor) error {
	stmts := []string{
		`TRUNCATE TABLE quotation_status_history RESTART IDENTITY CASCADE`,
		`TRUNCATE TABLE quotation_items RESTART IDENTITY CASCADE`,
		`TRUNCATE TABLE quotations RESTART IDENTITY CASCADE`,
	}
	for _, s := range stmts {
		if _, err := exec.Exec(ctx, s); err != nil {
			return err
		}
	}
	return nil
}

// ResetCommercialDomain truncates quotation/PO/invoice rows.
func ResetCommercialDomain(ctx context.Context, exec quotations.Executor) error {
	stmts := []string{
		`TRUNCATE TABLE invoice_items RESTART IDENTITY CASCADE`,
		`TRUNCATE TABLE invoices RESTART IDENTITY CASCADE`,
		`TRUNCATE TABLE purchase_order_items RESTART IDENTITY CASCADE`,
		`TRUNCATE TABLE purchase_orders RESTART IDENTITY CASCADE`,
		`TRUNCATE TABLE quotation_status_history RESTART IDENTITY CASCADE`,
		`TRUNCATE TABLE quotation_items RESTART IDENTITY CASCADE`,
		`TRUNCATE TABLE quotations RESTART IDENTITY CASCADE`,
	}
	for _, s := range stmts {
		if _, err := exec.Exec(ctx, s); err != nil {
			return err
		}
	}
	return nil
}
