package quotations_test

import (
	"context"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// sisterClient adds a client and contact.
func sisterClient(t *testing.T, ctx context.Context, tx pgx.Tx, active bool) (int64, int64) {
	t.Helper()
	var client, contact int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_client (name, address, is_active, created_by, updated_by)
		VALUES ('PT Saudara Holding', 'Jl. Gatot Subroto No. 5', $1, 1, 1) RETURNING id`, active).Scan(&client))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, email, created_by, updated_by)
		VALUES ($1, 'Ibu Sari', 'sari@holding.test', 1, 1) RETURNING id`, client).Scan(&contact))
	return client, contact
}

// Moving a draft to another client.
// The snapshot and contact follow, the reference, lines and prices stay,
// and the history names both clients.
func TestRepo_UpdateClient_MovesDraft(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	id := createWith(t, ctx, repo, offered())
	before, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	sister, contact := sisterClient(t, ctx, tx, true)
	_, err = repo.Lock(ctx, id, "header", seedUserID)
	require.NoError(t, err)

	require.NoError(t, repo.UpdateClient(ctx, id, sister, &contact, seedUserID))

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, sister, d.CompanyClientID)
	assert.Equal(t, "PT Saudara Holding", d.CompanyClientName)
	require.NotNil(t, d.ContactID)
	assert.Equal(t, contact, *d.ContactID)
	assert.Equal(t, "Ibu Sari", *d.ContactName)
	require.NotNil(t, d.ContactEmail)
	assert.Equal(t, "sari@holding.test", *d.ContactEmail)
	assert.Equal(t, before.ClientRefNo, d.ClientRefNo, "the client's reference stays")
	assert.Equal(t, before.GrandTotal, d.GrandTotal, "prices stay")
	require.Len(t, d.Items, len(before.Items))
	assert.Equal(t, before.Items[0].SellingPrice, d.Items[0].SellingPrice)
	assert.Equal(t, before.Items[0].VendorProductID, d.Items[0].VendorProductID)

	h := d.History[len(d.History)-1]
	require.NotNil(t, h.FromStatus)
	assert.Equal(t, quotations.StatusDraft, *h.FromStatus)
	assert.Equal(t, quotations.StatusDraft, h.ToStatus)
	require.NotNil(t, h.Note)
	assert.Equal(t, "Klien diganti dari PT. IMC Ship Management menjadi PT Saudara Holding", *h.Note)
	require.NotNil(t, h.ChangedBy)
	assert.Equal(t, seedUserID, *h.ChangedBy)
}

// No contact leaves the draft without one.
// The same client writes no history row.
func TestRepo_UpdateClient_NoContactSameClient(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id := createWith(t, ctx, repo, offered())
	_, err := repo.Lock(ctx, id, "header", seedUserID)
	require.NoError(t, err)
	before, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)

	require.NoError(t, repo.UpdateClient(ctx, id, seedCompanyID, nil, seedUserID))
	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	assert.Nil(t, d.ContactID)
	assert.Nil(t, d.ContactName)
	assert.Len(t, d.History, len(before.History))
}

// Refusals keep the draft as it was.
func TestRepo_UpdateClient_Refusals(t *testing.T) {
	tests := []struct {
		name       string
		setup      func(t *testing.T, ctx context.Context, tx pgx.Tx, id int64) (client int64, contact *int64)
		claim      bool
		wantStatus int
		wantField  string
		wantCode   string
		wantDetail string
	}{
		{
			name: "unknown quotation",
			setup: func(t *testing.T, ctx context.Context, tx pgx.Tx, _ int64) (int64, *int64) {
				c, k := sisterClient(t, ctx, tx, true)
				return c, &k
			},
			wantStatus: http.StatusNotFound,
		},
		{
			name: "no header claim",
			setup: func(t *testing.T, ctx context.Context, tx pgx.Tx, _ int64) (int64, *int64) {
				c, k := sisterClient(t, ctx, tx, true)
				return c, &k
			},
			wantStatus: http.StatusConflict,
			wantCode:   httperr.EditLockedCode,
			wantDetail: "Waktu mengubah bagian ini sudah habis. Buka lagi lalu simpan kembali.",
		},
		{
			name: "header held by another",
			setup: func(t *testing.T, ctx context.Context, tx pgx.Tx, id int64) (int64, *int64) {
				budi := newEditor(t, ctx, tx, "Budi")
				_, err := quotations.NewRepo(tx, testutil.Store(t)).Lock(ctx, id, "header", budi)
				require.NoError(t, err)
				c, k := sisterClient(t, ctx, tx, true)
				return c, &k
			},
			wantStatus: http.StatusConflict,
			wantCode:   httperr.EditLockedCode,
			wantDetail: "Sedang diubah oleh Budi.",
		},
		{
			name: "sent quotation",
			setup: func(t *testing.T, ctx context.Context, tx pgx.Tx, id int64) (int64, *int64) {
				forceStatus(t, ctx, tx, id, quotations.StatusSent)
				c, k := sisterClient(t, ctx, tx, true)
				return c, &k
			},
			claim:      false,
			wantStatus: http.StatusConflict,
			wantDetail: "Klien hanya dapat diganti saat quotation berstatus Draf. Untuk quotation yang sudah dikirim, buat revisi lalu ganti kliennya di draf revisi.",
		},
		{
			name: "inactive client",
			setup: func(t *testing.T, ctx context.Context, tx pgx.Tx, _ int64) (int64, *int64) {
				c, k := sisterClient(t, ctx, tx, false)
				return c, &k
			},
			claim:      true,
			wantStatus: http.StatusUnprocessableEntity,
			wantField:  "clientId",
		},
		{
			name: "missing client",
			setup: func(*testing.T, context.Context, pgx.Tx, int64) (int64, *int64) {
				return 99999999, nil
			},
			claim:      true,
			wantStatus: http.StatusUnprocessableEntity,
			wantField:  "clientId",
		},
		{
			name: "contact of another client",
			setup: func(t *testing.T, ctx context.Context, tx pgx.Tx, _ int64) (int64, *int64) {
				c, _ := sisterClient(t, ctx, tx, true)
				other := seedContactID
				return c, &other
			},
			claim:      true,
			wantStatus: http.StatusUnprocessableEntity,
			wantField:  "contactId",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, repo, tx := newRepo(t)
			id := createWith(t, ctx, repo, offered())
			client, contact := tc.setup(t, ctx, tx, id)
			if tc.claim {
				_, err := repo.Lock(ctx, id, "header", seedUserID)
				require.NoError(t, err)
			}
			target := id
			if tc.wantStatus == http.StatusNotFound {
				target = 99999999
			}
			err := attempt(t, ctx, tx, func() error {
				return repo.UpdateClient(ctx, target, client, contact, seedUserID)
			})
			e := httperr.FromDBErr(err)
			assert.Equal(t, tc.wantStatus, e.Status)
			if tc.wantField != "" {
				assert.NotEmpty(t, e.Fields[tc.wantField])
			}
			if tc.wantCode != "" {
				assert.Equal(t, tc.wantCode, e.Code)
			}
			if tc.wantDetail != "" {
				assert.Equal(t, tc.wantDetail, e.Detail)
			}
			d, err := repo.GetDetail(ctx, id)
			require.NoError(t, err)
			assert.Equal(t, seedCompanyID, d.CompanyClientID)
		})
	}
}

// PATCH /client validates the body.
func TestHandler_ChangeClient_Body(t *testing.T) {
	srv := liveServer(t, live.NewHub())
	id, _ := liveDraftOver(t, srv)
	base := "/quotations/" + strconv.FormatInt(id, 10)
	tests := []struct {
		name, path, body string
		want             int
		field            string
	}{
		{"bad id", "/quotations/abc/client", `{"clientId":1}`, http.StatusBadRequest, ""},
		{"bad json", base + "/client", `{`, http.StatusBadRequest, ""},
		{"no client", base + "/client", `{}`, http.StatusUnprocessableEntity, "clientId"},
		{"zero contact", base + "/client", `{"clientId":1,"contactId":0}`, http.StatusUnprocessableEntity, "contactId"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := doRaw(t, http.MethodPatch, srv.URL+tc.path, tc.body, nil)
			if tc.field == "" {
				res.Body.Close()
				assert.Equal(t, tc.want, res.StatusCode)
				return
			}
			e := problemOf(t, res)
			assert.Equal(t, tc.want, res.StatusCode)
			assert.NotEmpty(t, e.Fields[tc.field])
		})
	}
}

// A client change is a header change.
// Another editor's header claim refuses it; a saved change reaches the
// open editors.
func TestHandler_ClientChangeIsLive(t *testing.T) {
	pool := testutil.Pool(t)
	hub := live.NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go live.Listen(ctx, pool, hub, 10*time.Millisecond)
	srv := liveServer(t, hub)
	id, _ := liveDraftOver(t, srv)
	sister := committedSister(t)
	budi := committedEditor(t, "Budi")
	base := "/quotations/" + strconv.FormatInt(id, 10)
	body := `{"clientId":` + strconv.FormatInt(sister, 10) + `}`

	res := doJSONWithHeaders(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: "header"}, as(budi))
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	res = doRaw(t, http.MethodPatch, srv.URL+base+"/client", body, nil)
	e := problemOf(t, res)
	assert.Equal(t, http.StatusConflict, res.StatusCode)
	assert.Equal(t, httperr.EditLockedCode, e.Code)
	assert.Equal(t, "Sedang diubah oleh Budi.", e.Detail)
	res = doJSONWithHeaders(t, srv, http.MethodDelete, base+"/locks/header", nil, as(budi))
	res.Body.Close()
	res = doJSON(t, srv, http.MethodPost, base+"/locks", quotations.LockRequest{Part: "header"})
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)

	events, stop := hub.Subscribe(id)
	defer stop()
	waitListening(t, ctx, pool, events, id)

	res = doRaw(t, http.MethodPatch, srv.URL+base+"/client", body, nil)
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)
	notice := time.After(5 * time.Second)
	for {
		select {
		case ev := <-events:
			if ev.Kind == "probe" || ev.Kind == "locked" {
				continue
			}
			assert.Equal(t, live.Event{QuotationID: id, Kind: "header", Part: "header", UserID: seedUserID}, ev)
			return
		case <-notice:
			t.Fatal("no notice for the client change")
		}
	}
}

// committedSister adds a committed client.
// The quotation reset runs first, so the FK never blocks the delete.
func committedSister(t *testing.T) int64 {
	t.Helper()
	pool := testutil.Pool(t)
	ctx := context.Background()
	var id int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO company_client (name, created_by, updated_by)
		VALUES ('PT Saudara Live', 1, 1) RETURNING id`).Scan(&id))
	t.Cleanup(func() {
		_ = testutil.ResetQuotationDomain(ctx, pool)
		_, _ = pool.Exec(ctx, `DELETE FROM company_client WHERE id = $1`, id)
	})
	return id
}

// waitListening probes until LISTEN delivers.
// LISTEN starts asynchronously, so a notice sent before it is lost.
func waitListening(t *testing.T, ctx context.Context, pool *pgxpool.Pool, events <-chan live.Event, id int64) {
	t.Helper()
	probe := `{"quotationId": ` + strconv.FormatInt(id, 10) + `, "kind": "probe", "userId": 0}`
	deadline := time.After(5 * time.Second)
	for {
		_, err := pool.Exec(ctx, "SELECT pg_notify($1, $2)", live.Channel, probe)
		require.NoError(t, err)
		select {
		case ev := <-events:
			if ev.Kind == "probe" {
				return
			}
		case <-time.After(50 * time.Millisecond):
		case <-deadline:
			t.Fatal("listener never delivered")
		}
	}
}
