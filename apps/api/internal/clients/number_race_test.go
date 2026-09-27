package clients_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// blockWait bounds a blocked call.
const blockWait = 300 * time.Millisecond

// quoteFor is one priced line.
func quoteFor(clientID int64) quotations.CreateRequest {
	return quotations.CreateRequest{
		CompanyClientID: clientID, DiscountPct: "0",
		Items: []quotations.CreateItem{{
			RequestedName: "Barang Uji Nomor", Qty: "1", UnitID: 1, SellingPrice: "1000",
		}},
	}
}

// Numbers never drift from documents.
// A quotation being numbered and a client number change are serialised on
// the client row, so the stored number always matches the one every
// document of that client embeds, whichever commits first.
func TestNumberLock_QuotationRace(t *testing.T) {
	ctx := context.Background()
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	cleaner := testutil.NewCleaner(t)

	t.Run("a quotation being numbered blocks the change", func(t *testing.T) {
		clientID := ownedClient(t, cleaner)
		next := freeNumber(t, pool)

		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback(ctx) }()
		qid, err := quotations.NewRepo(tx, store).Create(ctx, quoteFor(clientID), seedUserID)
		require.NoError(t, err)
		cleaner.Quotation(qid)

		done := make(chan error, 1)
		go func() {
			_, err := clients.NewRepo(pool, store).Update(ctx, clientID, clients.UpdateClientRequest{
				Number: next, Name: "PT Nomor Balapan", CountryCode: "IDN", IsActive: true,
			}, seedUserID)
			done <- err
		}()
		select {
		case err := <-done:
			t.Fatalf("number change did not wait for the quotation: %v", err)
		case <-time.After(blockWait):
		}
		require.NoError(t, tx.Commit(ctx))

		require.ErrorIs(t, <-done, clients.ErrNumberLocked)
		var stored, quotationNo string
		require.NoError(t, pool.QueryRow(ctx, `
			SELECT cc.number, q.quotation_no
			FROM company_client cc JOIN quotations q ON q.company_client_id = cc.id
			WHERE q.id = $1`, qid).Scan(&stored, &quotationNo))
		assert.NotEqual(t, *next, stored)
		assert.Contains(t, quotationNo, stored)
	})

	t.Run("a change in flight numbers the quotation after it", func(t *testing.T) {
		clientID := ownedClient(t, cleaner)
		next := freeNumber(t, pool)

		tx, err := pool.Begin(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback(ctx) }()
		_, err = clients.NewRepo(tx, store).Update(ctx, clientID, clients.UpdateClientRequest{
			Number: next, Name: "PT Nomor Balapan", CountryCode: "IDN", IsActive: true,
		}, seedUserID)
		require.NoError(t, err)

		type created struct {
			id  int64
			err error
		}
		done := make(chan created, 1)
		go func() {
			id, err := quotations.NewRepo(pool, store).Create(ctx, quoteFor(clientID), seedUserID)
			done <- created{id, err}
		}()
		select {
		case c := <-done:
			cleaner.Quotation(c.id)
			t.Fatalf("quotation did not wait for the number change: %v", c.err)
		case <-time.After(blockWait):
		}
		require.NoError(t, tx.Commit(ctx))

		c := <-done
		require.NoError(t, c.err)
		cleaner.Quotation(c.id)
		var quotationNo string
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT quotation_no FROM quotations WHERE id = $1`, c.id).Scan(&quotationNo))
		assert.True(t, strings.Contains(quotationNo, *next), "%s embeds %s", quotationNo, *next)
	})
}

// ownedClient inserts a committed client.
// The shared cleaner deletes its quotations before it.
func ownedClient(t *testing.T, cleaner *testutil.Cleaner) int64 {
	t.Helper()
	pool := testutil.Pool(t)
	var id int64
	require.NoError(t, pool.QueryRow(context.Background(), `
		INSERT INTO company_client (number, name, country_code, created_by, updated_by)
		VALUES ($1, 'PT Nomor Balapan', 'IDN', $2, $2) RETURNING id`,
		*freeNumber(t, pool), seedUserID).Scan(&id))
	cleaner.Client(id)
	return id
}
