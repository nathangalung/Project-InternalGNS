package units

import (
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

// Routes returns the chi.Router untuk units domain.
// Mounted di /api/v1/units (lihat internal/app/router.go).
func Routes(d deps.Deps) chi.Router {
	r := chi.NewRouter()
	h := NewHandler(NewRepo(d.Pool))

	r.Get("/", h.List)

	return r
}
