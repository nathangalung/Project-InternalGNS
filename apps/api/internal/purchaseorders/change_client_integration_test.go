package purchaseorders_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// sisterClient adds a complete client.
// It has a valid NPWP, an address and one reachable contact, so the PO
// gate passes on it.
func sisterClient(t *testing.T, tx pgx.Tx, name string) (int64, int64) {
	t.Helper()
	ctx := context.Background()
	var client, contact int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_client (name, npwp, address, country_code, created_by, updated_by)
		VALUES ($1, '0213456789012345', 'Jl. Gatot Subroto No. 5, Jakarta', 'IDN', 1, 1)
		RETURNING id`, name).Scan(&client))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, email, country_code, created_by, updated_by)
		VALUES ($1::bigint, 'Ibu Sari', 'sari.' || $1::bigint::text || '@holding.test', 'IDN', 1, 1)
		RETURNING id`, client).Scan(&contact))
	return client, contact
}

// clientBody is a change request.
func clientBody(clientID int64, contactID *int64) purchaseorders.ChangeClientRequest {
	return purchaseorders.ChangeClientRequest{ClientID: clientID, ContactID: contactID}
}

// lastHistory reads the newest entry.
func lastHistory(t *testing.T, ctx context.Context, repo *purchaseorders.Repo, poID int64) purchaseorders.StatusHistoryEntry {
	t.Helper()
	rows, err := repo.History(ctx, poID)
	require.NoError(t, err)
	return rows[len(rows)-1]
}

// PATCH /client refusals and moves.
func TestHandler_ChangeClient(t *testing.T) {
	tests := []struct {
		name      string
		status    purchaseorders.Status
		id        string // "" means the fresh PO
		raw       string // overrides the JSON body when set
		client    string // "sister", "inactive", "missing"
		contact   string // "", "own", "foreign", "zero"
		ifMatch   string // "" current, "none", "stale", or verbatim
		want      int
		wantField string
		wantCode  string
	}{
		{name: "bad id", id: "abc", client: "sister", want: http.StatusBadRequest},
		{name: "missing If-Match", client: "sister", ifMatch: "none", want: http.StatusBadRequest},
		{name: "malformed If-Match", client: "sister", ifMatch: "x", want: http.StatusBadRequest},
		{name: "bad json", raw: "{", want: http.StatusBadRequest},
		{name: "no client", raw: `{"clientId":0}`, want: http.StatusUnprocessableEntity, wantField: "clientId"},
		{name: "zero contact", client: "sister", contact: "zero", want: http.StatusUnprocessableEntity, wantField: "contactId"},
		{name: "unknown PO", id: "99999999", client: "sister", want: http.StatusNotFound},
		{name: "stale If-Match", client: "sister", ifMatch: "stale", want: http.StatusConflict, wantCode: httperr.VersionConflictCode},
		{name: "missing client", client: "missing", want: http.StatusUnprocessableEntity, wantField: "clientId"},
		{name: "inactive client", client: "inactive", want: http.StatusUnprocessableEntity, wantField: "clientId"},
		{name: "contact of another client", client: "sister", contact: "foreign", want: http.StatusUnprocessableEntity, wantField: "contactId"},
		{name: "pending moves", status: purchaseorders.StatusPending, client: "sister", contact: "own", want: http.StatusOK},
		{name: "uploaded moves", status: purchaseorders.StatusUploaded, client: "sister", contact: "own", want: http.StatusOK},
		{name: "in progress moves", status: purchaseorders.StatusOnProgress, client: "sister", contact: "own", want: http.StatusOK},
		{name: "without a contact", client: "sister", want: http.StatusOK},
		{name: "delivered is locked", status: purchaseorders.StatusDelivered, client: "sister", contact: "own",
			want: http.StatusConflict, wantCode: purchaseorders.LockedCode},
		{name: "cancelled is locked", status: purchaseorders.StatusCancelled, client: "sister", contact: "own",
			want: http.StatusConflict, wantCode: purchaseorders.LockedCode},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			status := tc.status
			if status == "" {
				status = purchaseorders.StatusPending
			}
			_, poID := poAt(t, tx, status)
			sister, own := sisterClient(t, tx, "PT Saudara Holding")
			var client int64
			switch tc.client {
			case "sister":
				client = sister
			case "inactive":
				client = sister
				_, err := tx.Exec(ctx, `UPDATE company_client SET is_active = FALSE WHERE id = $1`, sister)
				require.NoError(t, err)
			case "missing":
				client = 99999999
			}
			var contact *int64
			switch tc.contact {
			case "own":
				contact = &own
			case "foreign":
				contact = new(int64(1)) // the seed client's contact
			case "zero":
				contact = new(int64(0))
			}

			id := tc.id
			if id == "" {
				id = strconv.FormatInt(poID, 10)
			}
			headers := map[string]string{"Content-Type": "application/json"}
			switch tc.ifMatch {
			case "":
				headers = mergeHeaders(headers, currentIfMatch(t, ctx, tx, poID))
			case "none":
			case "stale":
				headers["If-Match"] = "9999"
			default:
				headers["If-Match"] = tc.ifMatch
			}
			body := tc.raw
			if body == "" {
				body = mustJSON(t, clientBody(client, contact))
			}
			res := rawRequest(t, srv, http.MethodPatch, "/purchase-orders/"+id+"/client", body, headers)
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			if tc.want == http.StatusOK {
				var saved purchaseorders.UpdatedResponse
				readJSON(t, res, &saved)
				po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(ctx, poID)
				require.NoError(t, err)
				assert.Equal(t, po.RowVersion, saved.RowVersion)
				assert.Equal(t, sister, po.CompanyClientID)
				assert.Equal(t, "PT Saudara Holding", po.CompanyName)
				assert.Equal(t, status, po.Status, "the move keeps the status")
				return
			}
			p := readProblem(t, res)
			if tc.wantField != "" {
				assert.NotEmpty(t, p.Fields[tc.wantField])
			}
			if tc.wantCode != "" {
				assert.Equal(t, tc.wantCode, p.Code)
			}
		})
	}
}

// The PO carries the new client.
// Its contact, history row and delivery note address follow; the quotation
// keeps its own client.
func TestRepo_ChangeClient_CarriesClient(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qID, poID := acceptedQuotationWithPO(t, tx)
	sister, own := sisterClient(t, tx, "PT Saudara Holding")
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	before, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)

	v, err := repo.ChangeClient(ctx, poID, sister, &own, seedUserID, &before.RowVersion)
	require.NoError(t, err)
	assert.Greater(t, v, before.RowVersion)

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, po.ContactID)
	assert.Equal(t, own, *po.ContactID)
	assert.Equal(t, "Ibu Sari", *po.ContactName)
	require.NotNil(t, po.ContactEmail)
	assert.Contains(t, *po.ContactEmail, "@holding.test")
	assert.Nil(t, po.ContactPhone)

	h := lastHistory(t, ctx, repo, poID)
	require.NotNil(t, h.FromStatus)
	assert.Equal(t, purchaseorders.StatusPending, *h.FromStatus)
	assert.Equal(t, purchaseorders.StatusPending, h.ToStatus)
	require.NotNil(t, h.Note)
	assert.Equal(t, "Klien diganti dari PT. IMC Ship Management menjadi PT Saudara Holding", *h.Note)
	assert.Equal(t, seedUserID, h.ChangedBy)

	addr, err := repo.ClientAddress(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, "Jl. Gatot Subroto No. 5, Jakarta", addr)

	q, err := quotations.NewRepo(tx, testutil.Store(t)).GetDetail(ctx, qID)
	require.NoError(t, err)
	assert.Equal(t, seedCompanyID, q.CompanyClientID, "the quotation keeps its client")
}

// A same-client change sets the contact.
// Nothing changed is a no-op without a history row.
func TestRepo_ChangeClient_ContactOnly(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	alt := insertContact(t, tx, seedCompanyID, "Bp. Pengganti", strPtr("pengganti@gns.test"))
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	steps := []struct {
		contact  *int64
		wantNote string
	}{
		{&alt, "Narahubung diganti menjadi Bp. Pengganti"},
		{nil, "Narahubung dikosongkan"},
	}
	for _, s := range steps {
		po, err := repo.GetByID(ctx, poID)
		require.NoError(t, err)
		_, err = repo.ChangeClient(ctx, poID, seedCompanyID, s.contact, seedUserID, &po.RowVersion)
		require.NoError(t, err)
		h := lastHistory(t, ctx, repo, poID)
		require.NotNil(t, h.Note)
		assert.Equal(t, s.wantNote, *h.Note)
	}

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	count := len(mustHistory(t, ctx, repo, poID))
	v, err := repo.ChangeClient(ctx, poID, seedCompanyID, nil, seedUserID, &po.RowVersion)
	require.NoError(t, err)
	assert.Equal(t, po.RowVersion, v, "nothing changed")
	assert.Len(t, mustHistory(t, ctx, repo, poID), count)
}

func mustHistory(t *testing.T, ctx context.Context, repo *purchaseorders.Repo, poID int64) []purchaseorders.StatusHistoryEntry {
	t.Helper()
	rows, err := repo.History(ctx, poID)
	require.NoError(t, err)
	return rows
}

// The PO number must be free.
// The new client already has a live PO with the same number.
func TestHandler_ChangeClient_PONumberTaken(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	sister, own := sisterClient(t, tx, "PT Saudara Holding")
	_, otherPO := createQuotation(t, tx, quotations.CreateRequest{
		ValidityDays: testutil.Validity(), CompanyClientID: sister, ContactID: &own, DiscountPct: "0",
		Items: []quotations.CreateItem{quoteLine(strPtr("Kapal Uji"))},
	})
	_, err := tx.Exec(ctx, `UPDATE purchase_orders SET po_number = (SELECT po_number FROM purchase_orders WHERE id = $1)
		WHERE id = $2`, poID, otherPO)
	require.NoError(t, err)

	res := doJSONWithHeaders(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/client", poID),
		clientBody(sister, &own), currentIfMatch(t, ctx, tx, poID))
	defer res.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	p := readProblem(t, res)
	assert.Equal(t, purchaseorders.MsgPONumberTaken, p.Fields["clientId"])
}

// The gate reads the PO's contact.
// After the move the quotation's contact belongs to the old client, yet the
// new client's own contact passes.
func TestRepo_ChangeClient_GateReadsPOContact(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	contact := insertContact(t, tx, seedCompanyID, "Ibu Lama", strPtr("lama@gns.test"))
	_, poID := createQuotation(t, tx, quotations.CreateRequest{
		ValidityDays: testutil.Validity(), CompanyClientID: seedCompanyID, ContactID: &contact, DiscountPct: "0",
		Items: []quotations.CreateItem{quoteLine(strPtr("Kapal Uji"))},
	})
	sister, own := sisterClient(t, tx, "PT Saudara Holding")
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	_, err = repo.ChangeClient(ctx, poID, sister, &own, seedUserID, &po.RowVersion)
	require.NoError(t, err)

	issues, err := repo.Completeness(ctx, poID)
	require.NoError(t, err)
	assert.Empty(t, issues)

	// A PO left without a contact falls back to the client's first one.
	po, err = repo.GetByID(ctx, poID)
	require.NoError(t, err)
	_, err = repo.ChangeClient(ctx, poID, sister, nil, seedUserID, &po.RowVersion)
	require.NoError(t, err)
	issues, err = repo.Completeness(ctx, poID)
	require.NoError(t, err)
	assert.Empty(t, issues)
}

// Delivery bills the new client.
// fn_create_invoice copies the buyer from the PO's client; the reminder
// names the PO's contact.
func TestRepo_ChangeClient_DeliveredInvoiceBuyer(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)
	sister, _ := sisterClient(t, tx, "PT Saudara Holding")
	// Not the client's first contact, so a fallback would name another.
	second := insertContact(t, tx, sister, "Bp. Kedua", strPtr("kedua@holding.test"))
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	_, err = repo.ChangeClient(ctx, poID, sister, &second, seedUserID, &po.RowVersion)
	require.NoError(t, err)

	issues, err := repo.GatedTransition(ctx, poID, purchaseorders.StatusDelivered, "", seedUserID)
	require.NoError(t, err)
	require.Empty(t, issues)

	var invID, buyerClient int64
	var name, npwp, address string
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT id, company_client_id, buyer_name, buyer_npwp, buyer_address
		FROM invoices WHERE po_id = $1`, poID).Scan(&invID, &buyerClient, &name, &npwp, &address))
	assert.Equal(t, sister, buyerClient)
	assert.Equal(t, "PT Saudara Holding", name)
	assert.Equal(t, "0213456789012345", npwp)
	assert.Equal(t, "Jl. Gatot Subroto No. 5, Jakarta", address)

	irepo := invoices.NewRepo(tx, testutil.Store(t))
	inv, err := irepo.GetDetail(ctx, invID)
	require.NoError(t, err)
	require.NotNil(t, inv.ContactName)
	assert.Equal(t, "Bp. Kedua", *inv.ContactName)
	reminders, err := irepo.ReminderContacts(ctx, []int64{invID})
	require.NoError(t, err)
	require.NotNil(t, reminders[invID].ContactName)
	assert.Equal(t, "Bp. Kedua", *reminders[invID].ContactName)

	po, err = repo.GetByID(ctx, poID)
	require.NoError(t, err)
	_, err = repo.ChangeClient(ctx, poID, seedCompanyID, nil, seedUserID, &po.RowVersion)
	assert.ErrorIs(t, err, purchaseorders.ErrLocked, "delivered keeps the buyer")
}

// A live invoice locks the client.
// Only a legacy PO can have one before delivery.
func TestRepo_ChangeClient_LiveInvoiceLocks(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)
	_, err := tx.Exec(ctx, `SELECT fn_create_invoice($1, $2)`, poID, seedUserID)
	require.NoError(t, err)
	sister, own := sisterClient(t, tx, "PT Saudara Holding")
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	_, err = repo.ChangeClient(ctx, poID, sister, &own, seedUserID, &po.RowVersion)
	require.ErrorIs(t, err, purchaseorders.ErrLocked)
	assert.Equal(t, "Klien PO ini tidak dapat diganti karena invoicenya sudah terbit.", err.Error())
}

// An accepted quotation's contact reaches its PO.
// Only while the PO is still on the quotation's client.
func TestRepo_QuotationContactSyncsPO(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qID, poID := acceptedQuotationWithPO(t, tx)
	alt := insertContact(t, tx, seedCompanyID, "Bp. Baru", strPtr("baru@gns.test"))
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	require.NoError(t, qrepo.UpdateContact(ctx, qID, alt, seedUserID))
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, po.ContactID)
	assert.Equal(t, alt, *po.ContactID)

	sister, own := sisterClient(t, tx, "PT Saudara Holding")
	_, err = repo.ChangeClient(ctx, poID, sister, &own, seedUserID, &po.RowVersion)
	require.NoError(t, err)
	other := insertContact(t, tx, seedCompanyID, "Bp. Lain", strPtr("lain@gns.test"))
	require.NoError(t, qrepo.UpdateContact(ctx, qID, other, seedUserID))
	po, err = repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, own, *po.ContactID, "a moved PO keeps its own contact")
}

// mustJSON encodes a body.
func mustJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	require.NoError(t, err)
	return string(raw)
}

// mergeHeaders joins header maps.
func mergeHeaders(a, b map[string]string) map[string]string {
	for k, v := range b {
		a[k] = v
	}
	return a
}
