package invoices_test

import (
	"context"
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
	seedOfferedID = int64(1)
)

// A quotation whose product line matches a catalog item the customer did not
// name. The PO and invoice snapshot the request text, so the catalog name has
// to come from the offered item.
func offeredItemPOWithInvoice(t *testing.T, tx pgx.Tx) int64 {
	t.Helper()
	ctx := context.Background()
	store := testutil.Store(t)
	offered := seedOfferedID

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

func TestRepo_ListItems_CarriesOfferedItem(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	invID := offeredItemPOWithInvoice(t, tx)

	repo := invoices.NewRepo(tx, testutil.Store(t))
	items, err := repo.ListItems(ctx, invID)
	require.NoError(t, err)
	require.NotEmpty(t, items)

	line := items[0]
	require.NotNil(t, line.OfferedItemID)
	require.NotNil(t, line.OfferedItemName)
	assert.NotEqual(t, requestText, *line.OfferedItemName)
	assert.Equal(t, *line.OfferedItemName, line.DisplayName())
	require.NotNil(t, line.OfferedItemCode)
	assert.Equal(t, *line.OfferedItemCode, line.DisplayCode())

	bulk, err := repo.ListItemsBulk(ctx, []int64{invID})
	require.NoError(t, err)
	assert.Equal(t, items, bulk[invID])
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

func TestExport_PDFPrintsOfferedItem(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	invID := offeredItemPOWithInvoice(t, tx)

	store := testutil.Store(t)
	repo := invoices.NewRepo(tx, store)
	inv, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	items, err := repo.ListItems(ctx, invID)
	require.NoError(t, err)

	got := newExportHandler(t, tx).PDFTotalsForTest(ctx, inv, items)
	require.NotEmpty(t, got.LineNames)
	require.NotNil(t, items[0].OfferedItemName)
	assert.Equal(t, pdfgen.LatexEscape(*items[0].OfferedItemName), got.LineNames[0])
}
