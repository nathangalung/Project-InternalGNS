package db

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// Postgres SQLSTATE codes used.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const (
	codeUniqueViolation     = "23505"
	codeForeignKeyViolation = "23503"
	codeCheckViolation      = "23514"
	codeNotNullViolation    = "23502"
	codeSerialization       = "40001"
)

func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func IsUniqueViolation(err error) bool     { return pgCode(err) == codeUniqueViolation }
func IsForeignKeyViolation(err error) bool { return pgCode(err) == codeForeignKeyViolation }
func IsCheckViolation(err error) bool      { return pgCode(err) == codeCheckViolation }
func IsNotNullViolation(err error) bool    { return pgCode(err) == codeNotNullViolation }
func IsSerialization(err error) bool       { return pgCode(err) == codeSerialization }
