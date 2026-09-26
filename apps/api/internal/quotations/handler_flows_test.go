package quotations_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// problemOf decodes a problem+json body.
func problemOf(t *testing.T, res *http.Response) httperr.Error {
	t.Helper()
	defer res.Body.Close()
	var e httperr.Error
	require.NoError(t, json.NewDecoder(res.Body).Decode(&e))
	return e
}

// getJSON decodes a 200 body.
func getJSON(t *testing.T, srv *httptest.Server, path string, v any) {
	t.Helper()
	res := doJSON(t, srv, http.MethodGet, path, nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	require.NoError(t, json.NewDecoder(res.Body).Decode(v))
}

// doRaw sends a literal body.
func doRaw(t *testing.T, method, url, body string, headers map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	return res
}

// insertContact adds a committed contact.
// The quotation reset runs first, so the FK never blocks the delete.
func insertContact(t *testing.T, companyID int64, name string) int64 {
	t.Helper()
	pool := testutil.Pool(t)
	ctx := context.Background()
	var id int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, country_code, created_by, updated_by)
		VALUES ($1, $2, 'IDN', 1, 1) RETURNING id`, companyID, name).Scan(&id))
	t.Cleanup(func() {
		_ = testutil.ResetQuotationDomain(ctx, pool)
		_, _ = pool.Exec(ctx, `DELETE FROM company_contacts WHERE id = $1`, id)
	})
	return id
}

func idPath(id int64, suffix string) string {
	return "/quotations/" + strconv.FormatInt(id, 10) + suffix
}

func TestHandler_ChangeContact(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	sibling := insertContact(t, seedCompanyID, "Kontak Pengganti")
	foreign := insertContact(t, 2, "Kontak Klien Lain")

	cases := []struct {
		name      string
		path      string
		body      string
		want      int
		wantField string
	}{
		{"bad id", "/quotations/abc/contact", `{"contactId":1}`, http.StatusBadRequest, ""},
		{"bad json", idPath(id, "/contact"), `{`, http.StatusBadRequest, ""},
		{"missing contact", idPath(id, "/contact"), `{"contactId":0}`, http.StatusUnprocessableEntity, "contactId"},
		{"unknown quotation", "/quotations/9999999/contact",
			`{"contactId":` + strconv.FormatInt(sibling, 10) + `}`, http.StatusNotFound, ""},
		{"contact of another client", idPath(id, "/contact"),
			`{"contactId":` + strconv.FormatInt(foreign, 10) + `}`, http.StatusUnprocessableEntity, "contactId"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doRaw(t, http.MethodPatch, srv.URL+c.path, c.body, nil)
			e := problemOf(t, res)
			assert.Equal(t, c.want, res.StatusCode)
			assert.Equal(t, c.want, e.Status)
			if c.wantField != "" {
				assert.Contains(t, e.Fields, c.wantField)
			}
		})
	}

	t.Run("sibling contact is saved", func(t *testing.T) {
		res := doRaw(t, http.MethodPatch, srv.URL+idPath(id, "/contact"),
			`{"contactId":`+strconv.FormatInt(sibling, 10)+`}`, nil)
		res.Body.Close()
		require.Equal(t, http.StatusNoContent, res.StatusCode)

		var d quotations.QuotationDetail
		getJSON(t, srv, idPath(id, ""), &d)
		require.NotNil(t, d.ContactID)
		assert.Equal(t, sibling, *d.ContactID)
		require.NotNil(t, d.ContactName)
		assert.Equal(t, "Kontak Pengganti", *d.ContactName)
	})
}

func TestHandler_ItemRequests_Flow(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	base := idPath(id, "/requests")

	list := func(t *testing.T) []quotations.ItemRequestRow {
		t.Helper()
		res := doJSON(t, srv, http.MethodGet, base, nil)
		require.Equal(t, http.StatusOK, res.StatusCode)
		var rows []quotations.ItemRequestRow
		decodeBody(t, res, &rows)
		return rows
	}

	assert.Empty(t, list(t), "a new quotation has no requests")

	cres := doJSON(t, srv, http.MethodPost, base, map[string]any{
		"lineNo": 1, "requestText": "LAMP LED 12W", "requestedQty": "4", "requestedUom": "PCS",
	})
	require.Equal(t, http.StatusCreated, cres.StatusCode)
	var created quotations.ItemRequestRow
	decodeBody(t, cres, &created)
	assert.Equal(t, id, created.QuotationID)
	assert.Equal(t, "pending", created.MatchStatus)

	rows := list(t)
	require.Len(t, rows, 1)
	assert.Equal(t, created.ID, rows[0].ID)

	rid := strconv.FormatInt(created.ID, 10)
	ures := doJSON(t, srv, http.MethodPut, base+"/"+rid, map[string]any{
		"lineNo": 1, "requestText": "LAMP LED 12W COOL WHITE",
		"matchedItemId": seedItemID, "matchStatus": "matched", "sourceType": "manual",
	})
	require.Equal(t, http.StatusOK, ures.StatusCode)
	var updated quotations.ItemRequestRow
	decodeBody(t, ures, &updated)
	assert.Equal(t, "LAMP LED 12W COOL WHITE", updated.RequestText)
	assert.Equal(t, "matched", updated.MatchStatus)
	assert.Equal(t, int32(1), updated.RowVersion)
	require.NotNil(t, updated.ReviewedBy)
	assert.Equal(t, seedUserID, *updated.ReviewedBy)

	dres := doJSON(t, srv, http.MethodDelete, base+"/"+rid, nil)
	dres.Body.Close()
	require.Equal(t, http.StatusNoContent, dres.StatusCode)
	assert.Empty(t, list(t), "the deleted request is gone")
}

func TestHandler_ItemRequests_Errors(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	base := idPath(id, "/requests")
	validUpdate := `{"lineNo":1,"requestText":"x","matchStatus":"pending","sourceType":"manual"}`

	cases := []struct {
		name       string
		method     string
		path       string
		body       string
		want       int
		wantFields []string
	}{
		{"list bad id", http.MethodGet, "/quotations/abc/requests", "", http.StatusBadRequest, nil},
		{"create bad id", http.MethodPost, "/quotations/abc/requests", `{}`, http.StatusBadRequest, nil},
		{"create bad json", http.MethodPost, base, `{`, http.StatusBadRequest, nil},
		{"create blank", http.MethodPost, base, `{"lineNo":0,"requestText":""}`,
			http.StatusUnprocessableEntity, []string{"lineNo", "requestText"}},
		{"update bad id", http.MethodPut, "/quotations/abc/requests/1", validUpdate, http.StatusBadRequest, nil},
		{"update bad rid", http.MethodPut, base + "/abc", validUpdate, http.StatusBadRequest, nil},
		{"update bad json", http.MethodPut, base + "/1", `{`, http.StatusBadRequest, nil},
		{"update blank", http.MethodPut, base + "/1", `{"lineNo":0}`,
			http.StatusUnprocessableEntity, []string{"lineNo", "requestText", "matchStatus", "sourceType"}},
		{"update unknown", http.MethodPut, base + "/9999999", validUpdate, http.StatusNotFound, nil},
		{"delete bad id", http.MethodDelete, "/quotations/abc/requests/1", "", http.StatusBadRequest, nil},
		{"delete bad rid", http.MethodDelete, base + "/abc", "", http.StatusBadRequest, nil},
		{"delete unknown", http.MethodDelete, base + "/9999999", "", http.StatusNotFound, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doRaw(t, c.method, srv.URL+c.path, c.body, nil)
			e := problemOf(t, res)
			assert.Equal(t, c.want, res.StatusCode)
			for _, f := range c.wantFields {
				assert.Contains(t, e.Fields, f)
			}
			assert.Len(t, e.Fields, len(c.wantFields))
		})
	}
}

func TestHandler_Revisions(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)

	t.Run("bad id", func(t *testing.T) {
		res := doJSON(t, srv, http.MethodGet, "/quotations/abc/revisions", nil)
		res.Body.Close()
		assert.Equal(t, http.StatusBadRequest, res.StatusCode)
	})

	t.Run("a lone quotation lists itself", func(t *testing.T) {
		var revs []quotations.RevisionRow
		res := doJSON(t, srv, http.MethodGet, idPath(id, "/revisions"), nil)
		require.Equal(t, http.StatusOK, res.StatusCode)
		decodeBody(t, res, &revs)
		require.Len(t, revs, 1)
		assert.Equal(t, id, revs[0].ID)
	})

	t.Run("a revision joins the chain", func(t *testing.T) {
		sres := doJSON(t, srv, http.MethodPost, idPath(id, "/send"), nil)
		sres.Body.Close()
		require.Equal(t, http.StatusNoContent, sres.StatusCode)

		// An empty body is a revise without a note.
		rres := doRaw(t, http.MethodPost, srv.URL+idPath(id, "/revise"), "", nil)
		require.Equal(t, http.StatusCreated, rres.StatusCode)
		var created map[string]int64
		decodeBody(t, rres, &created)

		var revs []quotations.RevisionRow
		res := doJSON(t, srv, http.MethodGet, idPath(created["id"], "/revisions"), nil)
		require.Equal(t, http.StatusOK, res.StatusCode)
		decodeBody(t, res, &revs)
		require.Len(t, revs, 2)
		assert.Equal(t, id, revs[0].ID)
		assert.Equal(t, "revision", revs[0].Status)
		assert.Equal(t, created["id"], revs[1].ID)
		require.NotNil(t, revs[1].ParentID)
		assert.Equal(t, id, *revs[1].ParentID)
	})
}

func TestHandler_Revise_BadInput(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)

	cases := []struct {
		name, path, body string
	}{
		{"bad id", "/quotations/abc/revise", ""},
		{"bad json", idPath(id, "/revise"), `{"note":`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doRaw(t, http.MethodPost, srv.URL+c.path, c.body, nil)
			e := problemOf(t, res)
			assert.Equal(t, http.StatusBadRequest, res.StatusCode)
			assert.Equal(t, http.StatusBadRequest, e.Status)
		})
	}
}

func TestHandler_Update_MalformedIfMatch(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)

	res := doJSONWithHeaders(t, srv, http.MethodPut, idPath(id, ""),
		quotations.UpdateRequest{DiscountPct: "0", Items: sampleCreate().Items},
		map[string]string{"If-Match": `"v1"`})
	e := problemOf(t, res)
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
	assert.Equal(t, "invalid If-Match header", e.Detail)
}

// Q-14: unknown send is 404.
func TestHandler_Send_UnknownQuotation(t *testing.T) {
	srv, _ := resetServer(t)

	res := doJSON(t, srv, http.MethodPost, "/quotations/9999999/send", nil)
	e := problemOf(t, res)
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
	assert.Equal(t, "Quotation 9999999 tidak ditemukan.", e.Detail)
}

// Send notes reach the history.
func TestHandler_Send_KeepsTheNote(t *testing.T) {
	srv, _ := resetServer(t)

	cases := []struct {
		name, body, wantNote string
	}{
		{"custom note", `{"note":"Dikirim lewat email ke kapal"}`, "Dikirim lewat email ke kapal"},
		{"blank note falls back", `{"note":"   "}`, "Quotation dikirim ke klien"},
		{"no body falls back", "", "Quotation dikirim ke klien"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id := mustCreate(t, srv)
			res := doRaw(t, http.MethodPost, srv.URL+idPath(id, "/send"), c.body, nil)
			res.Body.Close()
			require.Equal(t, http.StatusNoContent, res.StatusCode)

			var d quotations.QuotationDetail
			getJSON(t, srv, idPath(id, ""), &d)
			assert.Equal(t, "sent", d.Status)
			last := d.History[len(d.History)-1]
			assert.Equal(t, "sent", last.ToStatus)
			require.NotNil(t, last.Note)
			assert.Equal(t, c.wantNote, *last.Note)
		})
	}
}

func TestHandler_Update_Refusals(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	zeroQty := sampleCreate().Items
	zeroQty[0].Qty = "0"

	cases := []struct {
		name      string
		path      string
		discount  string
		items     []quotations.CreateItem
		want      int
		wantField string
		wantMsg   string
	}{
		{"zero quantity line", idPath(id, ""), "0", zeroQty, http.StatusUnprocessableEntity,
			"items[0].qty", "jumlah harus lebih besar dari 0"},
		{"discount above 100", idPath(id, ""), "150", sampleCreate().Items, http.StatusUnprocessableEntity,
			"discountPct", discountMsg},
		{"negative discount", idPath(id, ""), "-1", sampleCreate().Items, http.StatusUnprocessableEntity,
			"discountPct", discountMsg},
		{"blank discount", idPath(id, ""), "", sampleCreate().Items, http.StatusUnprocessableEntity,
			"discountPct", discountMsg},
		{"unknown quotation", "/quotations/9999999", "0", sampleCreate().Items, http.StatusNotFound, "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSONWithHeaders(t, srv, http.MethodPut, c.path,
				quotations.UpdateRequest{DiscountPct: c.discount, Items: c.items},
				map[string]string{"If-Match": "0"})
			e := problemOf(t, res)
			assert.Equal(t, c.want, res.StatusCode)
			if c.wantField != "" {
				assert.Equal(t, c.wantMsg, e.Fields[c.wantField])
				assert.Equal(t, c.wantMsg, e.Detail)
			}
		})
	}
}

// Empty lists encode as arrays.
func TestHandler_List_EmptyIsArray(t *testing.T) {
	srv, _ := resetServer(t)
	mustCreate(t, srv)

	res := doJSON(t, srv, http.MethodGet, "/quotations/?q=tidak-ada-yang-cocok", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assert.Equal(t, "0", res.Header.Get("X-Total-Count"))
	raw, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	assert.JSONEq(t, `[]`, string(raw))
}
