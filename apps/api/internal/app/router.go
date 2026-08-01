package app

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/countries"
	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

func NewRouter(cfg Config, pool *pgxpool.Pool, store queries.Store, storageClient *storage.Client) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(requestIDResponseMiddleware)
	r.Use(trustedProxyIP)
	r.Use(accessLogMiddleware)
	r.Use(middleware.Recoverer)
	r.Use(requestTimeout(defaultRequestTimeout, renderRequestTimeout))
	r.Use(securityHeadersMiddleware)
	r.Use(bodyLimitMiddleware(2 * 1024 * 1024))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "If-Match", "X-Request-Id"},
		ExposedHeaders:   []string{"ETag", "Link", "X-Request-Id", "X-Total-Count"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	// Readiness pings the database so an orchestrator stops routing to an
	// instance whose Postgres is unreachable.
	r.Get("/readyz", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if pool == nil || pool.Ping(ctx) != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"unavailable"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	})

	d := deps.Deps{
		Pool:          pool,
		Tx:            pool,
		Queries:       store,
		TemplatesRoot: cfg.TemplatesRoot,
		Pdf: deps.PdfSettings{
			SignerName:    cfg.PdfSignerName,
			BankName:      cfg.PdfBankName,
			BankAccountNo: cfg.PdfBankAccountNo,
			BankAccountNm: cfg.PdfBankAccountNm,
			PaymentTerms:  cfg.PdfPaymentTerms,
		},
		Coretax: deps.CoretaxSettings{
			SellerTIN:   cfg.CoretaxSellerTIN,
			SellerIDTKU: cfg.CoretaxSellerIDTKU,
		},
		Storage: storageClient,
	}

	authSvc := auth.NewService(users.NewRepo(pool, store), cfg.JWTSecret, cfg.JWTExpiry).
		WithRefresh(auth.NewRefreshRepo(pool, store), cfg.RefreshTokenExpiry)
	authHandler := auth.NewHandler(authSvc)
	requireAuth := authMiddleware(authSvc)

	r.Route("/api/v1", func(r chi.Router) {
		r.Mount("/auth", auth.Routes(authHandler, requireAuth))

		r.Group(func(r chi.Router) {
			r.Use(requireAuth)

			r.Mount("/units", units.Routes(d))
			r.Mount("/countries", countries.Routes(d))
			r.Mount("/clients", clients.Routes(d))
			r.Mount("/items", items.Routes(d))
			r.Mount("/vendors", vendors.Routes(d))
			r.With(requireRole("superadmin", "operational")).
				Mount("/quotations", quotations.Routes(d))
			r.With(requireRole("superadmin", "operational")).
				Mount("/purchase-orders", purchaseorders.Routes(d))
			r.With(requireRole("superadmin", "finance")).
				Mount("/invoices", invoices.Routes(d))
			r.With(requireRole("superadmin")).
				Mount("/users", users.Routes(d))
			r.Mount("/dashboard", dashboard.Routes(d))

			// Proxy asset bytes through the authenticated API (MinIO stays internal).
			if storageClient != nil {
				storageH := storage.NewHandler(storageClient)
				r.With(authorizeBucket).Put("/storage/object", storageH.Put)
				r.With(authorizeBucket).Get("/storage/object", storageH.Get)
			}
		})
	})

	return r
}
