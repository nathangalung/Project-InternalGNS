package quotations_test

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// unpriceSentLine zeroes a sent line.
// No API path reaches this: a sent quotation is not editable. Older rows
// can still carry it, which is what the accept guard is for.
const unpriceSentLine = `UPDATE quotation_items SET selling_price = 0
	WHERE id = (SELECT min(id) FROM quotation_items WHERE quotation_id = $1 AND item_type = 'product')`

// Accepting needs priced offered lines.
// fn_change_quotation_status raises P0100, which the repo maps to a typed
// error.
func TestChangeStatus_AcceptRefusesUnpricedLine(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	id := createWith(t, ctx, repo, offered())
	require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
	_, err := tx.Exec(ctx, unpriceSentLine, id)
	require.NoError(t, err)

	err = repo.ChangeStatus(ctx, id, quotations.StatusAccepted, nil, seedUserID)
	require.ErrorIs(t, err, quotations.ErrUnpricedProducts)
}

// Refusal names the items field.
func TestHandler_AcceptUnpricedIsItemsField(t *testing.T) {
	srv, _ := resetServer(t)
	id := mustCreate(t, srv)
	path := "/quotations/" + strconv.FormatInt(id, 10)
	res := doJSON(t, srv, http.MethodPost, path+"/send", nil)
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)
	_, err := testutil.Pool(t).Exec(context.Background(), unpriceSentLine, id)
	require.NoError(t, err)

	res = doJSON(t, srv, http.MethodPatch, path+"/status", quotations.ChangeStatusRequest{Status: quotations.StatusAccepted})
	e := problemOf(t, res)
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	assert.Equal(t,
		"Semua baris produk harus memiliki harga jual sebelum quotation dikirim atau disetujui.",
		e.Fields["items"])
}
