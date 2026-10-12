package testutil

import (
	"context"
	"fmt"
	"math/rand/v2"
	"sync"
	"testing"
)

// IMPA codes for tests.
// Real IMPA sections end below 90, so the 9xxxxx block holds no catalog
// code. A process walks it from a random start, so its own codes never
// repeat, and skips any an active product already holds.
var (
	impaMu   sync.Mutex
	impaNext = rand.IntN(100_000)
	impaUsed int
)

// UniqueIMPA returns an unused code.
// Six digits, as items.impa_code requires, held by no active product.
func UniqueIMPA(t testing.TB) string {
	t.Helper()
	pool := Pool(t)
	impaMu.Lock()
	defer impaMu.Unlock()
	for impaUsed < 100_000 {
		code := fmt.Sprintf("9%05d", impaNext%100_000)
		impaNext++
		impaUsed++
		var held bool
		if err := pool.QueryRow(context.Background(),
			`SELECT EXISTS (SELECT 1 FROM items WHERE impa_code = $1 AND is_active)`, code).Scan(&held); err != nil {
			t.Fatalf("impa lookup: %v", err)
		}
		if !held {
			return code
		}
	}
	t.Fatal("no free test IMPA code left")
	return ""
}
