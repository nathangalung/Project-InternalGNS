package quotations_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// offerFixture is one catalog product.
type offerFixture struct {
	item       int64
	name, impa string
}

// newOfferFixture adds a coded product.
func newOfferFixture(t *testing.T, ctx context.Context, tx pgx.Tx) offerFixture {
	t.Helper()
	tag := strconv.FormatInt(time.Now().UnixNano(), 36)
	f := offerFixture{name: "Baut Kapal " + tag, impa: testutil.UniqueIMPA(t)}
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by)
		VALUES ($1, $2, 19, 1, 1) RETURNING id`, f.name, f.impa).Scan(&f.item))
	return f
}

// quoteOffering drafts one offered line.
func quoteOffering(t *testing.T, ctx context.Context, tx pgx.Tx, item int64) int64 {
	t.Helper()
	id, err := quotations.NewRepo(tx, testutil.Store(t)).Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
			{RequestedName: "Baut permintaan klien", OfferedItemID: &item, Qty: "2", UnitID: 19, SellingPrice: "50000"},
		}),
	}, seedUserID)
	require.NoError(t, err)
	return id
}

// storedOffer reads the frozen columns.
func storedOffer(t *testing.T, ctx context.Context, tx pgx.Tx, quotation int64) (name, impa *string) {
	t.Helper()
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT offered_name, offered_impa FROM quotation_items
		WHERE quotation_id = $1 AND item_type = 'product'`, quotation).Scan(&name, &impa))
	return name, impa
}

// productLine is the detail's product line.
func productLine(t *testing.T, d quotations.QuotationDetail) quotations.QuotationItem {
	t.Helper()
	for _, it := range d.Items {
		if it.ItemType == "product" {
			return it
		}
	}
	t.Fatal("no product line")
	return quotations.QuotationItem{}
}

// Leaving draft freezes the offer.
// Every move out of draft stores the offered product's name and IMPA code
// as they are then; a draft stores neither and reads the catalog.
func TestOfferSnapshot_LeavingDraftFreezes(t *testing.T) {
	cases := []struct {
		name   string
		moves  []quotations.Status
		frozen bool
	}{
		{"draft stays live", nil, false},
		{"sent", []quotations.Status{quotations.StatusSent}, true},
		{"cancelled draft", []quotations.Status{quotations.StatusCancelled}, true},
		{"accepted", []quotations.Status{quotations.StatusSent, quotations.StatusAccepted}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			f := newOfferFixture(t, ctx, tx)
			id := quoteOffering(t, ctx, tx, f.item)
			repo := quotations.NewRepo(tx, testutil.Store(t))
			note := "Batal uji"
			for _, s := range c.moves {
				require.NoError(t, repo.ChangeStatus(ctx, id, s, &note, seedUserID))
			}
			name, impa := storedOffer(t, ctx, tx, id)
			if !c.frozen {
				assert.Nil(t, name)
				assert.Nil(t, impa)
				return
			}
			require.NotNil(t, name)
			require.NotNil(t, impa)
			assert.Equal(t, f.name, *name)
			assert.Equal(t, f.impa, *impa)
		})
	}
}

// A product with no code freezes none.
// The stored code stays empty even once the product gains one.
func TestOfferSnapshot_NoCodeStaysNone(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	f := newOfferFixture(t, ctx, tx)
	_, err := tx.Exec(ctx, `UPDATE items SET impa_code = NULL WHERE id = $1`, f.item)
	require.NoError(t, err)
	id := quoteOffering(t, ctx, tx, f.item)
	repo := quotations.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
	_, err = tx.Exec(ctx, `UPDATE items SET impa_code = $2 WHERE id = $1`, f.item, f.impa)
	require.NoError(t, err)

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	line := productLine(t, d)
	require.NotNil(t, line.OfferedName)
	assert.Equal(t, f.name, *line.OfferedName)
	assert.Nil(t, line.OfferedImpa, "the code the client never saw stays off")
}

// quotationPDFText renders one quotation.
func quotationPDFText(t *testing.T, tx pgx.Tx, id int64) string {
	t.Helper()
	requireXelatex(t)
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		t.Skip("pdftotext unavailable")
	}
	rec := httptest.NewRecorder()
	servePDF(pdfExec{quotes: tx, clients: tx, units: tx, root: quotationTemplatesRoot(t)}.handler(t), rec, itoaQ(id))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	path := filepath.Join(t.TempDir(), "q.pdf")
	require.NoError(t, os.WriteFile(path, rec.Body.Bytes(), 0o600))
	out, err := exec.Command(bin, path, "-").Output()
	require.NoError(t, err)
	return strings.Join(strings.Fields(string(out)), " ")
}

// A rename never restates a sent quotation.
// The product page Ubah renames a product and changes its code. The sent
// quotation's detail and PDF keep what the client received, the draft
// shows the new name and code, and accepting the sent one copies its
// frozen offer to the PO.
func TestOfferSnapshot_RenameKeepsSentQuotation(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	f := newOfferFixture(t, ctx, tx)
	sent := quoteOffering(t, ctx, tx, f.item)
	draft := quoteOffering(t, ctx, tx, f.item)
	repo := quotations.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.ChangeStatus(ctx, sent, quotations.StatusSent, nil, seedUserID))

	newName, newImpa := "Baut Baja Galvanis "+f.name, testutil.UniqueIMPA(t)
	catalog := items.NewRepo(tx, testutil.Store(t))
	unit := int16(19)
	_, err := catalog.Update(ctx, f.item, items.UpdateItemRequest{
		Name: newName, IMPACode: &newImpa, DefaultUnitID: &unit, IsActive: true,
	}, seedUserID)
	require.NoError(t, err)

	offer := func(id int64) (string, string) {
		d, err := repo.GetDetail(ctx, id)
		require.NoError(t, err)
		line := productLine(t, d)
		require.NotNil(t, line.OfferedName)
		require.NotNil(t, line.OfferedImpa)
		return *line.OfferedName, *line.OfferedImpa
	}
	name, impa := offer(sent)
	assert.Equal(t, [2]string{f.name, f.impa}, [2]string{name, impa}, "the sent detail keeps its offer")
	name, impa = offer(draft)
	assert.Equal(t, [2]string{newName, newImpa}, [2]string{name, impa}, "a draft follows the catalog")

	text := quotationPDFText(t, tx, sent)
	assert.Contains(t, text, f.name)
	assert.Contains(t, text, f.impa)
	assert.NotContains(t, text, newName)
	assert.NotContains(t, text, newImpa)
	assert.Contains(t, quotationPDFText(t, tx, draft), newName)

	require.NoError(t, repo.ChangeStatus(ctx, sent, quotations.StatusAccepted, nil, seedUserID))
	var po int64
	require.NoError(t, tx.QueryRow(ctx, `SELECT id FROM purchase_orders WHERE quotation_id = $1`, sent).Scan(&po))
	lines, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, po)
	require.NoError(t, err)
	require.NotEmpty(t, lines)
	assert.Equal(t, f.name, lines[0].ItemName, "the PO orders what the client accepted")
	require.NotNil(t, lines[0].ItemCode)
	assert.Equal(t, f.impa, *lines[0].ItemCode)
}

// A revision draft follows the catalog.
// Buat Revisi clones a new draft, which reads the catalog live, while the
// original moves to revision and keeps what it was sent with.
func TestOfferSnapshot_RevisionDraftIsLive(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	f := newOfferFixture(t, ctx, tx)
	id := quoteOffering(t, ctx, tx, f.item)
	repo := quotations.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
	rev, err := repo.Revise(ctx, id, nil, seedUserID)
	require.NoError(t, err)

	name, impa := storedOffer(t, ctx, tx, rev)
	assert.Nil(t, name, "the revision draft reads the catalog")
	assert.Nil(t, impa)
	name, _ = storedOffer(t, ctx, tx, id)
	require.NotNil(t, name)
	assert.Equal(t, f.name, *name)
}

// Created past draft, it is frozen.
// The app only ever creates drafts, but fn_create_quotation takes a status,
// and a quotation it creates already filed keeps its offer from the start.
func TestOfferSnapshot_CreatedPastDraftFreezes(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	f := newOfferFixture(t, ctx, tx)
	lines := testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
		{RequestedName: "Baut permintaan klien", OfferedItemID: &f.item, Qty: "1", UnitID: 19, SellingPrice: "50000"},
	})
	payload, err := json.Marshal([]map[string]any{{
		"requested_name": "Baut permintaan klien", "offered_item_id": f.item,
		"vendor_product_id": *lines[0].VendorProductID, "qty": "1", "unit_id": 19,
		"selling_price": "50000", "cost_price": "25000",
	}})
	require.NoError(t, err)
	var id int64
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT fn_create_quotation($1, NULL, NULL, NULL, NULL, 30, 0, NULL, NULL, NULL, $2::jsonb, $3, NULL, 'sent')`,
		seedCompanyID, payload, seedUserID).Scan(&id))
	name, impa := storedOffer(t, ctx, tx, id)
	require.NotNil(t, name)
	require.NotNil(t, impa)
	assert.Equal(t, [2]string{f.name, f.impa}, [2]string{*name, *impa})
}
