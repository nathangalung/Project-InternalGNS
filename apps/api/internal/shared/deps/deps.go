// Package deps holds shared DI.
package deps

import (
	"context"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
)

// PdfSettings carries hardcoded PDF defaults.
type PdfSettings struct {
	SignerName    string
	BankName      string
	BankAccountNo string
	BankAccountNm string
	PaymentTerms  string
}

// CoretaxSettings carries seller-side identifiers for the DJP e-faktur XML.
type CoretaxSettings struct {
	SellerTIN   string
	SellerIDTKU string
}

// Deps holds shared application dependencies.
type Deps struct {
	// Pool serves reads; Tx opens a transaction for multi-write handlers.
	Pool          db.Executor
	Tx            db.TxBeginner
	Queries       queries.Store
	TemplatesRoot string
	Pdf           PdfSettings
	Coretax       CoretaxSettings
	Storage       *storage.Client
}

// User id context key.

type ctxKey int

const userIDKey ctxKey = iota

// WithUserID stores user id.
func WithUserID(ctx context.Context, userID int64) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

// CurrentUserID reads user id.
func CurrentUserID(ctx context.Context) int64 {
	if v, ok := ctx.Value(userIDKey).(int64); ok {
		return v
	}
	return 0
}

const userRoleKey ctxKey = iota + 100

// WithUserRole stores user role.
func WithUserRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, userRoleKey, role)
}

// CurrentUserRole reads user role.
func CurrentUserRole(ctx context.Context) string {
	if v, ok := ctx.Value(userRoleKey).(string); ok {
		return v
	}
	return ""
}
