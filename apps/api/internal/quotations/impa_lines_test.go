package quotations_test

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// problemFields reads a 422's fields.
func problemFields(t *testing.T, res *http.Response) map[string]string {
	t.Helper()
	require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	var p struct {
		Fields map[string]string `json:"fields"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	return p.Fields
}

// A request line stores its code once.
// A marked code is kept as six digits and leaves the request text; a code
// that is not six digits is refused on its field.
func TestHandler_Lines_RequestedImpa(t *testing.T) {
	srv, _ := resetServer(t)

	line := oneLine("1")
	line[0].RequestedName = "Kunci Ring 12 Titik (IMPA 611234)"
	line[0].RequestedImpa = strPtr("IMPA 611234")
	res := doJSON(t, srv, http.MethodPost, "/quotations/", createBody{
		CompanyClientID: seedCompanyID, DiscountPct: "0", Items: line,
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var created struct {
		ID int64 `json:"id"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&created))
	d := readDetail(t, srv, created.ID)
	require.Len(t, d.Items, 1)
	assert.Equal(t, "Kunci Ring 12 Titik", d.Items[0].RequestedName)
	require.NotNil(t, d.Items[0].RequestedImpa)
	assert.Equal(t, "611234", *d.Items[0].RequestedImpa)

	bad := oneLine("1")
	bad[0].RequestedImpa = strPtr("61123")
	res = doJSON(t, srv, http.MethodPost, "/quotations/", createBody{
		CompanyClientID: seedCompanyID, DiscountPct: "0", Items: bad,
	})
	defer res.Body.Close()
	assert.Equal(t, map[string]string{"items[0].requestedImpa": validate.IMPAMessage}, problemFields(t, res))
}

// A client request stores its code once.
// The code a request text marks moves into its empty code field.
func TestHandler_ItemRequests_RequestImpa(t *testing.T) {
	srv, _ := resetServer(t)
	res := doJSON(t, srv, http.MethodPost, "/quotations/", createBody{
		CompanyClientID: seedCompanyID, DiscountPct: "0", Items: oneLine("1"),
	})
	defer res.Body.Close()
	var created struct {
		ID int64 `json:"id"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&created))
	path := "/quotations/" + strconv.FormatInt(created.ID, 10) + "/requests"

	res = doJSON(t, srv, http.MethodPost, path, quotations.ItemRequestCreate{
		LineNo: 1, RequestText: "Tali Tambat 12mm IMPA 211234",
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var got quotations.ItemRequestRow
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.Equal(t, "Tali Tambat 12mm", got.RequestText)
	require.NotNil(t, got.RequestImpa)
	assert.Equal(t, "211234", *got.RequestImpa)

	res = doJSON(t, srv, http.MethodPost, path, quotations.ItemRequestCreate{
		LineNo: 2, RequestText: "Tali", RequestImpa: strPtr("TALI-1"),
	})
	defer res.Body.Close()
	assert.Equal(t, map[string]string{"requestImpa": validate.IMPAMessage}, problemFields(t, res))
}
