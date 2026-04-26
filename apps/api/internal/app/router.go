package app

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/countries"
	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/units"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

func NewRouter(cfg Config, pool *pgxpool.Pool) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-Id"},
		ExposedHeaders:   []string{"Link", "X-Request-Id"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	d := deps.Deps{Pool: pool}

	r.Route("/api/v1", func(r chi.Router) {
		// TODO: r.Use(authMiddleware(cfg.JWTSecret)) — when JWT auth is wired
		r.Mount("/units", units.Routes(d))
		r.Mount("/countries", countries.Routes(d))
		r.Mount("/clients", clients.Routes(d))
		r.Mount("/items", items.Routes(d))
		r.Mount("/vendors", vendors.Routes(d))
		r.Mount("/quotations", quotations.Routes(d))
	})

	_ = cfg
	return r
}
