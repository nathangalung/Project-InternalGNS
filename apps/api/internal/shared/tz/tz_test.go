package tz

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestJakarta(t *testing.T) {
	loc := Jakarta()
	assert.NotNil(t, loc)
	// Asia/Jakarta UTC+7, no DST.
	_, offset := time.Date(2026, 1, 1, 0, 0, 0, 0, loc).Zone()
	assert.Equal(t, 7*60*60, offset)
}

func TestJakarta_Cached(t *testing.T) {
	a := Jakarta()
	b := Jakarta()
	assert.Same(t, a, b)
}

func TestNow(t *testing.T) {
	now := Now()
	_, offset := now.Zone()
	assert.Equal(t, 7*60*60, offset)
}
