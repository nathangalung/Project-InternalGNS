package invoices_test

import (
	"context"
	"encoding/xml"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	requestText   = "valve 2 inch pls check"
	offeredName   = "BALL VALVE 2IN SS316 SNAPSHOT"
	offeredCode   = "T58001"
	renamedName   = "BALL VALVE 2IN SS316 RENAMED"
	renamedCode   = "T58002"
	offeredUnitID = seedUnitID
)

// Catalog item the customer did not name.
func createOfferedItem(t *testing.T, tx pgx.Tx) int64 {
	t.Helper()
	var id int64
	err := tx.QueryRow(context.Background(),
		`INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by)
		 VALUES ($1, $2, $3, $4, $4) RETURNING id`,
		offeredName, offeredCode, offeredUnitID, seedUserID,
	).Scan(&id)
	require.NoError(t, err)
	return id
}

// Invoice whose line offers another item.
func offeredItemPOWithInvoice(t *testing.T, tx pgx.Tx, offered int64) int64 {
	t.Helper()
	ctx := context.Background()
	store := testutil.Store(t)

	qrepo := quotations.NewRepo(tx, store)
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName: requestText,
			OfferedItemID: &offered,
			Qty:           "1",
			UnitID:        seedUnitID,
			SellingPrice:  "100000",
		}},
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	porepo := purchaseorders.NewRepo(tx, store)
	po, err := porepo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusUploaded, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusDelivered, seedUserID))

	inv, err := invoices.NewRepo(tx, store).GetByQuotation(ctx, qid)
	require.NoError(t, err)
	return inv.ID
}

// newExportHandler wires the PDF builder against the test transaction.
func newExportHandler(t *testing.T, tx pgx.Tx) *invoices.ExportHandler {
	t.Helper()
	store := testutil.Store(t)
	return invoices.NewExportHandler(
		invoices.NewRepo(tx, store),
		clients.NewRepo(tx, store),
		quotations.NewRepo(tx, store),
		purchaseorders.NewRepo(tx, store),
		pdfgen.NewRenderer(t.TempDir()),
		deps.PdfSettings{},
	)
}

type coretaxGood struct {
	Code string `xml:"Code"`
	Name string `xml:"Name"`
}

// Coretax goods rows for one invoice.
func coretaxGoods(t *testing.T, tx pgx.Tx, invID int64) []coretaxGood {
	t.Helper()
	rec := exportCoretaxXML(t, tx, invID)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var doc struct {
		Goods []coretaxGood `xml:"ListOfTaxInvoice>TaxInvoice>ListOfGoodService>GoodService"`
	}
	require.NoError(t, xml.Unmarshal(rec.Body.Bytes(), &doc))
	return doc.Goods
}

// PDF line names for one invoice.
func pdfLineNames(t *testing.T, tx pgx.Tx, invID int64) []string {
	t.Helper()
	ctx := context.Background()
	repo := invoices.NewRepo(tx, testutil.Store(t))
	inv, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	items, err := repo.ListItems(ctx, invID)
	require.NoError(t, err)
	return newExportHandler(t, tx).PDFTotalsForTest(ctx, inv, items).LineNames
}

func TestInvoice_SnapshotsOfferedItem(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	invID := offeredItemPOWithInvoice(t, tx, createOfferedItem(t, tx))

	items, err := invoices.NewRepo(tx, testutil.Store(t)).ListItems(ctx, invID)
	require.NoError(t, err)
	require.NotEmpty(t, items)
	assert.Equal(t, offeredName, items[0].ItemName)
	require.NotNil(t, items[0].ItemCode)
	assert.Equal(t, offeredCode, *items[0].ItemCode)
}

// A filed invoice never restates its goods.
func TestInvoice_CatalogRenameLeavesIssuedInvoice(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	itemID := createOfferedItem(t, tx)
	invID := offeredItemPOWithInvoice(t, tx, itemID)
	repo := invoices.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.ChangeStatus(ctx, invID, invoices.StatusSent, seedUserID))

	pdfBefore := pdfLineNames(t, tx, invID)
	goodsBefore := coretaxGoods(t, tx, invID)
	require.Equal(t, []string{offeredName}, pdfBefore)
	require.Equal(t, []coretaxGood{{Code: offeredCode, Name: offeredName}}, goodsBefore)

	_, err := tx.Exec(ctx,
		`UPDATE items SET name = $2, impa_code = $3 WHERE id = $1`,
		itemID, renamedName, renamedCode)
	require.NoError(t, err)

	assert.Equal(t, pdfBefore, pdfLineNames(t, tx, invID))
	assert.Equal(t, goodsBefore, coretaxGoods(t, tx, invID))

	items, err := repo.ListItems(ctx, invID)
	require.NoError(t, err)
	bulk, err := repo.ListItemsBulk(ctx, []int64{invID})
	require.NoError(t, err)
	assert.Equal(t, items, bulk[invID])
}
