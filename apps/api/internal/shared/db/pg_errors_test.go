package db

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
)

func mkErr(code string) error {
	return &pgconn.PgError{Code: code}
}

func TestIsUniqueViolation(t *testing.T) {
	assert.True(t, IsUniqueViolation(mkErr("23505")))
	assert.False(t, IsUniqueViolation(mkErr("23503")))
	assert.False(t, IsUniqueViolation(errors.New("plain")))
	assert.False(t, IsUniqueViolation(nil))
}

func TestIsForeignKeyViolation(t *testing.T) {
	assert.True(t, IsForeignKeyViolation(mkErr("23503")))
	assert.False(t, IsForeignKeyViolation(mkErr("23505")))
}

func TestIsCheckViolation(t *testing.T) {
	assert.True(t, IsCheckViolation(mkErr("23514")))
	assert.False(t, IsCheckViolation(mkErr("23505")))
}

func TestIsNotNullViolation(t *testing.T) {
	assert.True(t, IsNotNullViolation(mkErr("23502")))
	assert.False(t, IsNotNullViolation(mkErr("23505")))
}

func TestIsSerialization(t *testing.T) {
	assert.True(t, IsSerialization(mkErr("40001")))
	assert.False(t, IsSerialization(mkErr("23505")))
}
