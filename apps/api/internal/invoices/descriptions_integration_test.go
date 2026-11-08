package invoices_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const descDest = "Gudang Cakung Blok C7"

// Two products, one addressed.
// The addressed line's Description starts at its destination, the other
// starts blank.
func twoLineInvoice(t *testing.T, tx pgx.Tx) int64 {
	t.Helper()
	dest := descDest
	req := oneLineQuotation()
	req.Items = []quotations.CreateItem{
		{RequestedName: "Tali Tambat", Qty: "2", UnitID: seedUnitID, SellingPrice: "100000", ShipDestination: &dest},
		{RequestedName: "Cat Kapal", Qty: "1", UnitID: seedUnitID, SellingPrice: "50000"},
	}
	_, _, invID := deliverQuotation(t, tx, req)
	return invID
}

// invoiceLines reads the lines.
func invoiceLines(t *testing.T, tx pgx.Tx, invID int64) []invoices.InvoiceItem {
	t.Helper()
	items, err := invoices.NewRepo(tx, testutil.Store(t)).ListItems(context.Background(), invID)
	require.NoError(t, err)
	require.Len(t, items, 2)
	return items
}

// invoiceVersion reads the If-Match value.
func invoiceVersion(t *testing.T, tx pgx.Tx, invID int64) int32 {
	t.Helper()
	inv, err := invoices.NewRepo(tx, testutil.Store(t)).GetByID(context.Background(), invID)
	require.NoError(t, err)
	return inv.RowVersion
}

// patchDescriptions sends one save.
// ifMatch "" leaves the header out.
func patchDescriptions(t *testing.T, tx pgx.Tx, invID int64, ifMatch string, body any) (int, httperr.Error) {
	t.Helper()
	srv := assetServer(t, tx)
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	req, err := http.NewRequest(http.MethodPatch,
		fmt.Sprintf("%s/invoices/%d/descriptions", srv.URL, invID), bytes.NewReader(raw))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	var e httperr.Error
	if res.StatusCode != http.StatusOK {
		require.NoError(t, json.NewDecoder(res.Body).Decode(&e))
	}
	return res.StatusCode, e
}

// printed is a Description cell.
func printed(s string) string { return pdfgen.LatexAddress(s, pdfgen.CellKeep) }

func lines(ls ...invoices.LineDescription) invoices.UpdateDescriptionsRequest {
	return invoices.UpdateDescriptionsRequest{Lines: ls}
}

// Descriptions save, then print.
// A saved description replaces the default, a cleared one prints nothing,
// and a line never saved keeps printing its destination.
func TestHandler_UpdateDescriptions_RoundTrip(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	invID := twoLineInvoice(t, tx)
	before := invoiceLines(t, tx, invID)
	assert.Nil(t, before[0].Description, "a new invoice has no saved description")
	assert.Equal(t, []string{printed(descDest), ""},
		newExportHandler(t, tx).PDFTotalsForTest(invoices.InvoiceDetail{}, before).LineDescriptions,
		"until a save each line prints its destination")

	v := invoiceVersion(t, tx, invID)
	code, e := patchDescriptions(t, tx, invID, strconv.Itoa(int(v)), lines(
		invoices.LineDescription{LineID: before[1].ID, Description: "  Warna abu abu, 5 liter  "},
	))
	require.Equal(t, http.StatusOK, code, e.Detail)
	assert.Greater(t, invoiceVersion(t, tx, invID), v)

	after := invoiceLines(t, tx, invID)
	assert.Nil(t, after[0].Description, "a line the save left out stays unsaved")
	require.NotNil(t, after[1].Description)
	assert.Equal(t, "Warna abu abu, 5 liter", *after[1].Description)
	assert.Equal(t, []string{printed(descDest), printed("Warna abu abu, 5 liter")},
		newExportHandler(t, tx).PDFTotalsForTest(invoices.InvoiceDetail{}, after).LineDescriptions)

	code, e = patchDescriptions(t, tx, invID, strconv.Itoa(int(invoiceVersion(t, tx, invID))), lines(
		invoices.LineDescription{LineID: after[0].ID, Description: ""},
	))
	require.Equal(t, http.StatusOK, code, e.Detail)
	cleared := invoiceLines(t, tx, invID)
	require.NotNil(t, cleared[0].Description)
	assert.Empty(t, *cleared[0].Description)
	assert.Equal(t, []string{"", printed("Warna abu abu, 5 liter")},
		newExportHandler(t, tx).PDFTotalsForTest(invoices.InvoiceDetail{}, cleared).LineDescriptions,
		"a cleared description prints nothing, never the destination")
}

// Refused saves.
// Each case runs on its own transaction, since a refusal the function
// raises aborts the one it ran in, and the save is one statement, so a
// refusal leaves nothing behind.
func TestHandler_UpdateDescriptions_Refusals(t *testing.T) {
	ok := func(line int64) any {
		return lines(invoices.LineDescription{LineID: line, Description: "Isi"})
	}
	tests := []struct {
		name   string
		status []invoices.Status
		// ifMatch adds to the current version, or "" sends none.
		ifMatch string
		body    func(line, foreign int64) any
		id      func(invID int64) int64
		code    int
		field   string
		detail  string
	}{
		{name: "no If-Match", body: func(l, _ int64) any { return ok(l) }, code: http.StatusBadRequest},
		{name: "stale If-Match", ifMatch: "stale", body: func(l, _ int64) any { return ok(l) }, code: http.StatusConflict},
		{name: "empty list", ifMatch: "current", body: func(_, _ int64) any { return lines() },
			code: http.StatusUnprocessableEntity, field: "lines"},
		{name: "line sent twice", ifMatch: "current", body: func(l, _ int64) any {
			return lines(
				invoices.LineDescription{LineID: l, Description: "A"},
				invoices.LineDescription{LineID: l, Description: "B"},
			)
		}, code: http.StatusUnprocessableEntity, field: "lines[1].lineId"},
		{name: "too long", ifMatch: "current", body: func(l, _ int64) any {
			return lines(invoices.LineDescription{LineID: l, Description: strings.Repeat("x", 501)})
		}, code: http.StatusUnprocessableEntity, field: "lines[0].description"},
		{name: "line of another invoice", ifMatch: "current", body: func(_, f int64) any { return ok(f) },
			code: http.StatusUnprocessableEntity, detail: "Baris ini bukan baris invoice ini. Muat ulang halaman."},
		{name: "missing invoice", ifMatch: "current", body: func(l, _ int64) any { return ok(l) },
			id: func(int64) int64 { return 999999999 }, code: http.StatusNotFound},
		{name: "paid is filed", status: []invoices.Status{invoices.StatusSent, invoices.StatusPaid},
			ifMatch: "current", body: func(l, _ int64) any { return ok(l) }, code: http.StatusConflict,
			detail: "Deskripsi invoice yang sudah lunas atau dibatalkan tidak dapat diubah."},
		{name: "cancelled is filed", status: []invoices.Status{invoices.StatusCancelled},
			ifMatch: "current", body: func(l, _ int64) any { return ok(l) }, code: http.StatusConflict,
			detail: "Deskripsi invoice yang sudah lunas atau dibatalkan tidak dapat diubah."},
		{name: "sent stays open", status: []invoices.Status{invoices.StatusSent},
			ifMatch: "current", body: func(l, _ int64) any { return ok(l) }, code: http.StatusOK},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			invID := twoLineInvoice(t, tx)
			foreign := invoiceLines(t, tx, twoLineInvoice(t, tx))[0].ID
			repo := invoices.NewRepo(tx, testutil.Store(t))
			for _, s := range tc.status {
				require.NoError(t, repo.ChangeStatus(ctx, invID, move(s), seedUserID))
			}
			line := invoiceLines(t, tx, invID)[0].ID
			v := strconv.Itoa(int(invoiceVersion(t, tx, invID)))
			ifMatch := map[string]string{"": "", "current": v, "stale": v + "5"}[tc.ifMatch]
			target := invID
			if tc.id != nil {
				target = tc.id(invID)
			}

			code, e := patchDescriptions(t, tx, target, ifMatch, tc.body(line, foreign))
			assert.Equal(t, tc.code, code, e.Detail)
			if tc.field != "" {
				assert.Contains(t, e.Fields, tc.field)
			}
			if tc.detail != "" {
				assert.Equal(t, tc.detail, e.Detail)
			}
		})
	}
}
