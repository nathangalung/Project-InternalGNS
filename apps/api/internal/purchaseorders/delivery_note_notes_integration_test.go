package purchaseorders_test

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// productLineIDs lists the PO's product lines.
func productLineIDs(t *testing.T, tx pgx.Tx, poID int64) []int64 {
	t.Helper()
	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(context.Background(), poID)
	require.NoError(t, err)
	var out []int64
	for _, it := range items {
		if it.ItemType == "product" {
			out = append(out, it.ID)
		}
	}
	return out
}

// currentVersion reads the If-Match value.
func currentVersion(t *testing.T, tx pgx.Tx, poID int64) string {
	t.Helper()
	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByID(context.Background(), poID)
	require.NoError(t, err)
	return strconv.Itoa(int(po.RowVersion))
}

func notesPath(poID int64) string {
	return fmt.Sprintf("/purchase-orders/%d/delivery-note", poID)
}

// Notes save, then read back.
// A cleared note stays empty, never the default.
func TestHandler_UpdateDeliveryNote_RoundTrip(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)
	line := productLineIDs(t, tx, poID)[0]
	before := currentVersion(t, tx, poID)

	res := doJSONWithHeaders(t, srv, http.MethodPatch, notesPath(poID),
		purchaseorders.UpdateDeliveryNoteRequest{Notes: []purchaseorders.DeliveryNoteLineNote{
			{LineID: line, Note: "  Serahkan ke mualim  "},
		}}, map[string]string{"If-Match": before})
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var saved purchaseorders.UpdatedResponse
	readJSON(t, res, &saved)
	assert.Equal(t, poID, saved.ID)
	assert.Equal(t, currentVersion(t, tx, poID), strconv.Itoa(int(saved.RowVersion)))
	assert.NotEqual(t, before, strconv.Itoa(int(saved.RowVersion)))

	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	require.NotNil(t, items[0].DnNote)
	assert.Equal(t, "Serahkan ke mualim", *items[0].DnNote, "the note is stored trimmed")

	res = doJSONWithHeaders(t, srv, http.MethodPatch, notesPath(poID),
		purchaseorders.UpdateDeliveryNoteRequest{Notes: []purchaseorders.DeliveryNoteLineNote{{LineID: line, Note: " "}}},
		map[string]string{"If-Match": strconv.Itoa(int(saved.RowVersion))})
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)

	res = doJSON(t, srv, http.MethodGet, fmt.Sprintf("/purchase-orders/%d/items", poID), nil)
	defer res.Body.Close()
	var rows []map[string]any
	readJSON(t, res, &rows)
	note, ok := rows[0]["dnNote"]
	assert.True(t, ok, "a cleared note is sent as empty")
	assert.Equal(t, "", note)
}

// Notes writes refused.
// The status, the version, the lines and the text are each checked.
func TestHandler_UpdateDeliveryNote_Refusals(t *testing.T) {
	long := strings.Repeat("n", 501)
	tests := []struct {
		name   string
		status purchaseorders.Status
		// notes builds the body from this PO's product line and another PO's.
		notes   func(line, foreign, shipping int64) []purchaseorders.DeliveryNoteLineNote
		ifMatch string
		role    string
		want    int
		detail  string
		code    string
		field   string
	}{
		{name: "pending has no delivery note", status: purchaseorders.StatusPending, want: http.StatusConflict,
			detail: "Catatan surat jalan hanya bisa diubah saat PO Dalam Progres atau Dikirim.", code: purchaseorders.LockedCode},
		{name: "uploaded has no delivery note", status: purchaseorders.StatusUploaded, want: http.StatusConflict, code: purchaseorders.LockedCode},
		{name: "cancelled is closed", status: purchaseorders.StatusCancelled, want: http.StatusConflict, code: purchaseorders.LockedCode},
		{name: "delivered keeps its note open", status: purchaseorders.StatusDelivered, want: http.StatusOK},
		{name: "a stale version", status: purchaseorders.StatusOnProgress, ifMatch: "stale",
			want: http.StatusConflict, detail: httperr.VersionConflict().Detail, code: httperr.VersionConflictCode},
		{name: "no If-Match", status: purchaseorders.StatusOnProgress, ifMatch: "none",
			want: http.StatusBadRequest, detail: "If-Match header required"},
		{name: "a malformed If-Match", status: purchaseorders.StatusOnProgress, ifMatch: "abc",
			want: http.StatusBadRequest, detail: "invalid If-Match header"},
		{name: "another PO's line", status: purchaseorders.StatusOnProgress,
			notes: func(_, foreign, _ int64) []purchaseorders.DeliveryNoteLineNote {
				return []purchaseorders.DeliveryNoteLineNote{{LineID: foreign, Note: "x"}}
			},
			want: http.StatusUnprocessableEntity, detail: "Baris ini bukan baris produk PO ini. Muat ulang halaman."},
		{name: "the shipping line", status: purchaseorders.StatusOnProgress,
			notes: func(_, _, shipping int64) []purchaseorders.DeliveryNoteLineNote {
				return []purchaseorders.DeliveryNoteLineNote{{LineID: shipping, Note: "x"}}
			},
			want: http.StatusUnprocessableEntity, detail: "Baris ini bukan baris produk PO ini."},
		{name: "no rows", status: purchaseorders.StatusOnProgress,
			notes: func(int64, int64, int64) []purchaseorders.DeliveryNoteLineNote { return nil },
			want:  http.StatusUnprocessableEntity, field: "notes"},
		{name: "a row sent twice", status: purchaseorders.StatusOnProgress,
			notes: func(line, _, _ int64) []purchaseorders.DeliveryNoteLineNote {
				return []purchaseorders.DeliveryNoteLineNote{{LineID: line, Note: "a"}, {LineID: line, Note: "b"}}
			},
			want: http.StatusUnprocessableEntity, field: "notes[1].lineId"},
		{name: "no line id", status: purchaseorders.StatusOnProgress,
			notes: func(int64, int64, int64) []purchaseorders.DeliveryNoteLineNote {
				return []purchaseorders.DeliveryNoteLineNote{{Note: "a"}}
			},
			want: http.StatusUnprocessableEntity, field: "notes[0].lineId"},
		{name: "a note over 500 characters", status: purchaseorders.StatusOnProgress,
			notes: func(line, _, _ int64) []purchaseorders.DeliveryNoteLineNote {
				return []purchaseorders.DeliveryNoteLineNote{{LineID: line, Note: long}}
			},
			want: http.StatusUnprocessableEntity, field: "notes[0].note"},
		{name: "a note of 500 characters", status: purchaseorders.StatusOnProgress,
			notes: func(line, _, _ int64) []purchaseorders.DeliveryNoteLineNote {
				return []purchaseorders.DeliveryNoteLineNote{{LineID: line, Note: long[:500]}}
			},
			want: http.StatusOK},
		{name: "operational input only views", status: purchaseorders.StatusOnProgress, role: roles.OperationalInput,
			want: http.StatusForbidden},
		{name: "operational runs the PO", status: purchaseorders.StatusOnProgress, role: roles.Operational,
			want: http.StatusOK},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, tx, srv := txServer(t)
			addr, cost := "Dermaga Koja Utara", "50000"
			_, poID := createQuotation(t, tx, quotations.CreateRequest{
				ValidityDays: testutil.Validity(), CompanyClientID: seedCompanyID, DiscountPct: "0",
				ShippingAddress: &addr, ShippingCost: &cost,
				Items: []quotations.CreateItem{{RequestedName: "Tali Tambang", Qty: "1", UnitID: seedUnitID, SellingPrice: "1000"}},
			})
			reachStatus(t, tx, poID, tc.status)
			_, otherPO := acceptedQuotationWithPO(t, tx)
			items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(context.Background(), poID)
			require.NoError(t, err)
			line, shipping := items[0].ID, shippingLine(t, items).ID
			notes := []purchaseorders.DeliveryNoteLineNote{{LineID: line, Note: "Serahkan ke mualim"}}
			if tc.notes != nil {
				notes = tc.notes(line, productLineIDs(t, tx, otherPO)[0], shipping)
			}
			headers := map[string]string{"If-Match": currentVersion(t, tx, poID)}
			switch tc.ifMatch {
			case "stale":
				headers["If-Match"] += "9"
			case "none":
				delete(headers, "If-Match")
			case "":
			default:
				headers["If-Match"] = tc.ifMatch
			}
			if tc.role != "" {
				headers[roleHeader] = tc.role
			}

			res := doJSONWithHeaders(t, srv, http.MethodPatch, notesPath(poID),
				purchaseorders.UpdateDeliveryNoteRequest{Notes: notes}, headers)
			defer res.Body.Close()
			require.Equal(t, tc.want, res.StatusCode)
			if tc.want == http.StatusOK {
				return
			}
			p := readProblem(t, res)
			assert.Contains(t, p.Detail, tc.detail)
			assert.Equal(t, tc.code, p.Code)
			if tc.field != "" {
				assert.NotEmpty(t, p.Fields[tc.field], "fields %v", p.Fields)
			}
		})
	}
}

// Missing PO and bad id.
func TestHandler_UpdateDeliveryNote_Unknown(t *testing.T) {
	_, _, srv := txServer(t)
	body := purchaseorders.UpdateDeliveryNoteRequest{Notes: []purchaseorders.DeliveryNoteLineNote{{LineID: 1, Note: "x"}}}
	tests := []struct {
		name, path string
		want       int
	}{
		{"a missing PO", notesPath(999999999), http.StatusNotFound},
		{"a malformed id", "/purchase-orders/abc/delivery-note", http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := doJSONWithHeaders(t, srv, http.MethodPatch, tc.path, body, map[string]string{"If-Match": "1"})
			defer res.Body.Close()
			assert.Equal(t, tc.want, res.StatusCode)
		})
	}
}

// Ubah PO keeps the notes.
// It replaces every line, so a kept line carries its note by id and a new
// line starts with none.
func TestRepo_UpdateItems_KeepsDeliveryNotes(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := poAt(t, tx, purchaseorders.StatusOnProgress)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	line := productLineIDs(t, tx, poID)[0]
	_, err := repo.UpdateDeliveryNotes(ctx, poID, []purchaseorders.DeliveryNoteLineNote{{LineID: line, Note: "Serahkan ke mualim"}}, seedUserID, nil)
	require.NoError(t, err)

	kept := itemsWith(purchaseorders.UpdateItemsLine{ID: &line, ShipDestination: strPtr("Kapal Uji")})
	added := kept.Items[0]
	added.ID = nil
	kept.Items = append(kept.Items, added)
	_, err = repo.UpdateItems(ctx, poID, kept, seedUserID, nil)
	require.NoError(t, err)

	items, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	require.Len(t, items, 2)
	require.NotNil(t, items[0].DnNote)
	assert.Equal(t, "Serahkan ke mualim", *items[0].DnNote)
	assert.Nil(t, items[1].DnNote, "a new line has no note")
}

// The items read carries defaults.
// A line going somewhere other than the Address starts with where it goes;
// the client's address is the Address when the lines name two places.
func TestHandler_ListItems_NoteDefaults(t *testing.T) {
	tests := []struct {
		name     string
		shipping *string
		dests    []string
		want     []string
	}{
		{"the shipping address is the Address", strPtr("Dermaga Koja Utara"),
			[]string{"", "Gudang Cakung", "dermaga koja utara"},
			[]string{"", "Kirim ke: Gudang Cakung", ""}},
		{"two places fall back to the client", nil,
			[]string{"Gudang Cakung", "Pelabuhan Tanjung Priok"},
			[]string{"Kirim ke: Gudang Cakung", "Kirim ke: Pelabuhan Tanjung Priok"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, err := tx.Exec(ctx, `UPDATE company_client SET address = 'Jl. Klien No. 1, Jakarta' WHERE id = $1`, seedCompanyID)
			require.NoError(t, err)
			poID := poWithDestinations(t, tx, tc.shipping, tc.dests)

			res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/purchase-orders/%d/items", poID), nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var items []purchaseorders.PurchaseOrderItem
			readJSON(t, res, &items)
			var got []string
			for _, it := range items {
				if it.ItemType == "product" {
					got = append(got, it.DnNoteDefault)
				}
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

// The client read fails loudly.
func TestHandler_ListItems_ClientAddressFault(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	poID := poWithDestinations(t, tx, nil, []string{"Gudang Cakung", "Pelabuhan Tanjung Priok"})
	srv := execServer(t, &testutil.CountingExec{Inner: tx, FailAfter: 1}, "")
	res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/purchase-orders/%d/items", poID), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusInternalServerError, res.StatusCode)
}

// poWithDestinations builds a working PO.
// Each product line goes to its destination, blank for none.
func poWithDestinations(t *testing.T, tx pgx.Tx, shipping *string, dests []string) int64 {
	t.Helper()
	req := quotations.CreateRequest{
		ValidityDays: testutil.Validity(), CompanyClientID: seedCompanyID, DiscountPct: "0",
		ShippingAddress: shipping,
	}
	names := []string{"Tali Tambang Nilon", "Cat Kapal Merah", "Lampu Sorot LED"}
	for i, d := range dests {
		it := quotations.CreateItem{RequestedName: names[i], Qty: "2", UnitID: seedUnitID, SellingPrice: "1000"}
		if d != "" {
			it.ShipDestination = strPtr(d)
		}
		req.Items = append(req.Items, it)
	}
	_, poID := createQuotation(t, tx, req)
	reachStatus(t, tx, poID, purchaseorders.StatusOnProgress)
	return poID
}

// The note prints its Address and Notes.
// The Address is where the goods go and prints once; a row prints its saved
// note, a row going elsewhere says where, and the others stay blank.
func TestDeliveryNote_PrintsAddressAndNotes(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	addr := "Dermaga Koja Utara"
	poID := poWithDestinations(t, tx, &addr, []string{"", "Gudang Cakung", "dermaga koja utara"})
	lines := productLineIDs(t, tx, poID)
	_, err := purchaseorders.NewRepo(tx, testutil.Store(t)).UpdateDeliveryNotes(ctx, poID,
		[]purchaseorders.DeliveryNoteLineNote{{LineID: lines[0], Note: "Serahkan ke mualim"}}, seedUserID, nil)
	require.NoError(t, err)

	srv := execServer(t, tx, poTemplatesRoot(t))
	res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/purchase-orders/%d/delivery-note.pdf", poID), nil)
	defer res.Body.Close()
	if _, err := exec.LookPath("xelatex"); err != nil {
		t.Skip("xelatex not installed; the PDF body is not checked")
	}
	require.Equal(t, http.StatusOK, res.StatusCode)
	pdf, err := io.ReadAll(res.Body)
	require.NoError(t, err)

	text := pdfText(t, pdf)
	assert.Regexp(t, `Address\s*:\s*Dermaga Koja Utara`, text, "the Address is the shipping address")
	assert.Equal(t, 1, strings.Count(text, addr), "no row repeats the Address")
	assert.Contains(t, text, "Notes")
	assert.NotContains(t, text, "Tujuan")
	assert.Contains(t, text, "Serahkan ke mualim")
	assert.Equal(t, 1, strings.Count(text, "Kirim ke:"), "only the line going elsewhere says where")
	assert.Contains(t, text, "Gudang Cakung")
}
