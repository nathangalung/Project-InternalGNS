package purchaseorders_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// workingPO is a PO in progress.
func workingPO(t *testing.T, tx pgx.Tx, status purchaseorders.Status) int64 {
	t.Helper()
	_, poID := createQuotation(t, tx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName: "Tali Tambang Nilon", Qty: "4", UnitID: seedUnitID, SellingPrice: "100000",
		}},
	})
	reachStatus(t, tx, poID, status)
	return poID
}

// dnSeq reads a note's running number.
func dnSeq(t *testing.T, dn string) int {
	t.Helper()
	var seq int
	_, err := fmt.Sscanf(dn, "DN-%05d/", &seq)
	require.NoError(t, err, dn)
	return seq
}

// The number follows the downloads.
// Moving to Dalam Progres issues nothing; the first download does, so a
// PO that started work earlier but is downloaded later gets the later
// number. Every later download keeps it.
func TestDeliveryNote_IssuedInDownloadOrder(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	first := workingPO(t, tx, purchaseorders.StatusOnProgress)
	second := workingPO(t, tx, purchaseorders.StatusOnProgress)

	for _, id := range []int64{first, second} {
		po, err := repo.GetByID(ctx, id)
		require.NoError(t, err)
		assert.Nil(t, po.DeliveryNoteNumber, "Dalam Progres issues no number")
		assert.Nil(t, po.DeliveryNoteDate)
	}

	later, err := repo.IssueDeliveryNote(ctx, second, seedUserID)
	require.NoError(t, err)
	earlier, err := repo.IssueDeliveryNote(ctx, first, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, dnSeq(t, later)+1, dnSeq(t, earlier), "the PO downloaded first gets the lower number")

	again, err := repo.IssueDeliveryNote(ctx, second, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, later, again, "a second download keeps the number")

	var today time.Time
	require.NoError(t, tx.QueryRow(ctx, `SELECT CURRENT_DATE`).Scan(&today))
	po, err := repo.GetByID(ctx, second)
	require.NoError(t, err)
	require.NotNil(t, po.DeliveryNoteNumber)
	assert.Equal(t, later, *po.DeliveryNoteNumber)
	require.NotNil(t, po.DeliveryNoteDate, "issuing stamps the date")
	assert.Equal(t, today.Format(time.DateOnly), po.DeliveryNoteDate.Format(time.DateOnly))

	var notes int
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT count(*) FROM po_status_history WHERE po_id = $1 AND note = $2`,
		second, "Nomor Surat Jalan "+later+" diterbitkan").Scan(&notes))
	assert.Equal(t, 1, notes, "the history names the issue once")
}

// No number before work starts.
func TestDeliveryNote_IssueRefusedBeforeWork(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	poID := workingPO(t, tx, purchaseorders.StatusUploaded)

	srv := execServer(t, tx, poTemplatesRoot(t))
	res := doJSON(t, srv, http.MethodGet,
		"/purchase-orders/"+strconv.FormatInt(poID, 10)+"/delivery-note.pdf", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusConflict, res.StatusCode)

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Nil(t, po.DeliveryNoteNumber)

	// Last: the refusal aborts the transaction.
	_, err = repo.IssueDeliveryNote(ctx, poID, seedUserID)
	require.Error(t, err)
	assert.True(t, errors.Is(err, purchaseorders.ErrLocked), err)
}

// A download issues the number.
// The number is issued before the PDF is rendered, so it stands even when
// rendering fails, and the next download prints it.
func TestDeliveryNote_DownloadIssuesNumber(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	poID := workingPO(t, tx, purchaseorders.StatusOnProgress)

	srv := execServer(t, tx, poTemplatesRoot(t))
	res := doJSON(t, srv, http.MethodGet,
		"/purchase-orders/"+strconv.FormatInt(poID, 10)+"/delivery-note.pdf", nil)
	defer res.Body.Close()
	require.NotEqual(t, http.StatusConflict, res.StatusCode)

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, po.DeliveryNoteNumber, "the download issued the number")
}

// Delivered without a download.
// Dikirim issues the number when no one downloaded the note, since the
// invoice it files carries that number.
func TestDeliveryNote_DeliveredIssuesWhenNeverDownloaded(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	poID := workingPO(t, tx, purchaseorders.StatusDelivered)

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, po.DeliveryNoteNumber)
	var invoiceNo string
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT invoice_no FROM invoices WHERE po_id = $1`, poID).Scan(&invoiceNo))
	assert.Equal(t, "INV"+(*po.DeliveryNoteNumber)[2:], invoiceNo)
}

// The number before the first download.
// The web asks for it before the save dialog opens, so even the first
// file is named after the note; asking again returns the same number.
func TestHandler_DeliveryNoteNumber(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	working := workingPO(t, tx, purchaseorders.StatusOnProgress)
	uploaded := workingPO(t, tx, purchaseorders.StatusUploaded)
	srv := execServer(t, tx, poTemplatesRoot(t))
	path := func(id int64) string {
		return "/purchase-orders/" + strconv.FormatInt(id, 10) + "/delivery-note/number"
	}

	var first purchaseorders.DeliveryNoteNumberResponse
	res := doJSON(t, srv, http.MethodGet, path(working), nil)
	require.Equal(t, http.StatusOK, res.StatusCode)
	require.NoError(t, json.NewDecoder(res.Body).Decode(&first))
	res.Body.Close()
	assert.Regexp(t, `^DN-[0-9]{5,}/GNS/[IVXLC]+/[0-9]{4}$`, first.DeliveryNoteNumber)

	var again purchaseorders.DeliveryNoteNumberResponse
	res = doJSON(t, srv, http.MethodGet, path(working), nil)
	require.Equal(t, http.StatusOK, res.StatusCode)
	require.NoError(t, json.NewDecoder(res.Body).Decode(&again))
	res.Body.Close()
	assert.Equal(t, first, again, "asking again keeps the number")

	po, err := repo.GetByID(ctx, working)
	require.NoError(t, err)
	require.NotNil(t, po.DeliveryNoteNumber)
	assert.Equal(t, first.DeliveryNoteNumber, *po.DeliveryNoteNumber)

	// Last: the refusal aborts the transaction.
	res = doJSON(t, srv, http.MethodGet, path(uploaded), nil)
	assert.Equal(t, http.StatusConflict, res.StatusCode)
	assert.Equal(t, "Surat jalan tersedia setelah status PO Dalam Progres.", readProblem(t, res).Detail)
	res.Body.Close()
}

func TestHandler_DeliveryNoteNumber_Refusals(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	srv := execServer(t, tx, poTemplatesRoot(t))
	for path, want := range map[string]int{
		"/purchase-orders/x/delivery-note/number":        http.StatusBadRequest,
		"/purchase-orders/99999999/delivery-note/number": http.StatusNotFound,
	} {
		res := doJSON(t, srv, http.MethodGet, path, nil)
		assert.Equal(t, want, res.StatusCode, path)
		res.Body.Close()
	}
}
