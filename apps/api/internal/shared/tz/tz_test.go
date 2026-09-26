package tz

import (
	"errors"
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

// Missing tzdata still yields WIB.
// A slim image without zoneinfo must still format dates at UTC+7.
func TestJakartaFrom_FallsBackWithoutTZData(t *testing.T) {
	loc := jakartaFrom(func(string) (*time.Location, error) {
		return nil, errors.New("unknown time zone Asia/Jakarta")
	})
	assert.Equal(t, "WIB", loc.String())
	name, offset := time.Date(2026, 7, 1, 0, 0, 0, 0, loc).Zone()
	assert.Equal(t, "WIB", name)
	assert.Equal(t, 7*60*60, offset)
}

// Loader receives the zone name.
func TestJakartaFrom_UsesLoadedZone(t *testing.T) {
	var asked string
	want := time.FixedZone("probe", 0)
	loc := jakartaFrom(func(name string) (*time.Location, error) {
		asked = name
		return want, nil
	})
	assert.Equal(t, "Asia/Jakarta", asked)
	assert.Same(t, want, loc)
}
