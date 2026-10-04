package quotations_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Ids for document-number fixtures.
const (
	docNoClientA int64 = 9100001
	docNoClientB int64 = 9100002
)

// docNo splits a document number.
// Type, running number, Roman month and year.
var docNo = regexp.MustCompile(`^(Q|INV|DN)-([0-9]{5,})/GNS/(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)/([0-9]{4})$`)

// insertClient writes a client fixture.
// It returns the insert error.
func insertClient(t *testing.T, ctx context.Context, id int64, number any) error {
	t.Helper()
	_, err := testutil.Pool(t).Exec(ctx,
		`INSERT INTO company_client (id, number, name, country_code, created_by, updated_by)
		 VALUES ($1, $2, $3, 'IDN', 1, 1)`,
		id, number, "Doc No Fixture "+string(rune('A'+id%26)))
	return err
}

// dropClients removes fixtures and dependents.
func dropClients(t *testing.T, ids ...int64) {
	t.Helper()
	ctx := context.Background()
	pool := testutil.Pool(t)
	for _, id := range ids {
		_, _ = pool.Exec(ctx, `DELETE FROM quotation_items WHERE quotation_id IN
			(SELECT id FROM quotations WHERE company_client_id = $1)`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM quotation_status_history WHERE quotation_id IN
			(SELECT id FROM quotations WHERE company_client_id = $1)`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM quotations WHERE company_client_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM company_client WHERE id = $1`, id)
	}
}

// Client numbers are four digits.
//
// The number stays a fixed-width, unique key even though no document number
// embeds it any more.
func TestCompanyClientNumber_FixedFourDigits(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()
	t.Cleanup(func() { dropClients(t, docNoClientA, docNoClientB) })

	cases := []struct {
		name    string
		number  any
		wantErr bool
	}{
		{"four digits", "0901", false},
		{"leading zeroes", "0001", false},
		{"letters", "SQA", true},
		{"letters with digit", "SQA1", true},
		{"too short", "901", true},
		{"too long", "09011", true},
		{"empty", "", true},
		{"null", nil, true},
		{"spaces", " 901", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dropClients(t, docNoClientA)
			err := insertClient(t, ctx, docNoClientA, tc.number)
			if tc.wantErr {
				require.Error(t, err, "number %v must be refused", tc.number)
				return
			}
			require.NoError(t, err)
		})
	}

	t.Run("duplicate", func(t *testing.T) {
		dropClients(t, docNoClientA, docNoClientB)
		require.NoError(t, insertClient(t, ctx, docNoClientA, "0902"))
		err := insertClient(t, ctx, docNoClientB, "0902")
		require.Error(t, err, "a client number must be unique")
	})

	var n int64
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM company_client WHERE number IS NULL OR number !~ '^[0-9]{4}$'`,
	).Scan(&n))
	assert.Zero(t, n, "every existing client must carry a four digit number after the backfill")
}

// nextDocNo draws one number.
func nextDocNo(t *testing.T, ctx context.Context, tx pgx.Tx, docType string) string {
	t.Helper()
	var no string
	require.NoError(t, tx.QueryRow(ctx, `SELECT fn_next_doc_no($1)`, docType).Scan(&no))
	return no
}

// seqOf reads the running number.
func seqOf(t *testing.T, no string) int {
	t.Helper()
	m := docNo.FindStringSubmatch(no)
	require.NotNil(t, m, "%q is not a document number", no)
	n, err := strconv.Atoi(m[2])
	require.NoError(t, err)
	return n
}

// Numbers carry the WIB period.
// Each type prints its prefix, a five-digit running number and the Roman
// month and year of today's WIB date.
func TestNextDocNo_Format(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	var roman, year string
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT fn_month_to_roman(EXTRACT(MONTH FROM CURRENT_DATE)::int),
		       EXTRACT(YEAR FROM CURRENT_DATE)::text`).Scan(&roman, &year))
	for _, docType := range []string{"Q", "INV", "DN"} {
		t.Run(docType, func(t *testing.T) {
			no := nextDocNo(t, ctx, tx, docType)
			m := docNo.FindStringSubmatch(no)
			require.NotNil(t, m, "%q is not a document number", no)
			assert.Equal(t, docType, m[1])
			assert.Equal(t, roman, m[3])
			assert.Equal(t, year, m[4])
		})
	}
}

// Every month has its numeral.
func TestMonthToRoman(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	want := []string{"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"}
	for i, w := range want {
		var got string
		require.NoError(t, tx.QueryRow(ctx, `SELECT fn_month_to_roman($1)`, i+1).Scan(&got))
		assert.Equal(t, w, got, "month %d", i+1)
	}
}

// One counter per type.
// Drawing a quotation number never moves the invoice or delivery-note
// counter, and the quotation counter only ever grows by one.
func TestNextDocNo_CountersPerType(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	inv := seqOf(t, nextDocNo(t, ctx, tx, "INV"))
	dn := seqOf(t, nextDocNo(t, ctx, tx, "DN"))
	q1 := seqOf(t, nextDocNo(t, ctx, tx, "Q"))
	q2 := seqOf(t, nextDocNo(t, ctx, tx, "Q"))

	assert.Equal(t, q1+1, q2)
	assert.Equal(t, inv+1, seqOf(t, nextDocNo(t, ctx, tx, "INV")))
	assert.Equal(t, dn+1, seqOf(t, nextDocNo(t, ctx, tx, "DN")))
}

// Past 99999 the number grows.
// lpad would cut the sixth digit and reissue an old number.
func TestNextDocNo_GrowsPastFiveDigits(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, err := tx.Exec(ctx, `UPDATE doc_counters SET last_seq = 99998 WHERE doc_type = 'DN'`)
	require.NoError(t, err)

	assert.Regexp(t, `^DN-99999/GNS/`, nextDocNo(t, ctx, tx, "DN"))
	assert.Regexp(t, `^DN-100000/GNS/`, nextDocNo(t, ctx, tx, "DN"))
	assert.Regexp(t, `^DN-100001/GNS/`, nextDocNo(t, ctx, tx, "DN"))
}

// Only Q, INV and DN are numbered.
// A PO carries the client's own number.
func TestNextDocNo_UnknownType(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	var no string
	err := tx.QueryRow(ctx, `SELECT fn_next_doc_no('PO')`).Scan(&no)
	require.ErrorContains(t, err, "unknown document type PO")
}

// A rollback returns the number.
// The counter is a row, not a sequence, so an aborted document leaves no
// gap.
func TestNextDocNo_RollbackLeavesNoGap(t *testing.T) {
	ctx := context.Background()
	pool := testutil.Pool(t)

	first, err := pool.Begin(ctx)
	require.NoError(t, err)
	drawn := nextDocNo(t, ctx, first, "INV")
	require.NoError(t, first.Rollback(ctx))

	second, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = second.Rollback(ctx) }()
	assert.Equal(t, drawn, nextDocNo(t, ctx, second, "INV"))
}

// Concurrent callers queue.
// The second caller waits on the counter row and takes the next number
// once the first commits.
func TestNextDocNo_ConcurrentCallersDiffer(t *testing.T) {
	ctx := context.Background()
	pool := testutil.Pool(t)

	first, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = first.Rollback(ctx) }()
	a := nextDocNo(t, ctx, first, "Q")

	type drawn struct {
		no  string
		err error
	}
	done := make(chan drawn, 1)
	go func() {
		tx, err := pool.Begin(ctx)
		if err != nil {
			done <- drawn{err: err}
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		var no string
		err = tx.QueryRow(ctx, `SELECT fn_next_doc_no('Q')`).Scan(&no)
		done <- drawn{no, err}
	}()
	select {
	case d := <-done:
		t.Fatalf("second caller did not wait for the first: %+v", d)
	case <-time.After(300 * time.Millisecond):
	}
	require.NoError(t, first.Commit(ctx))

	b := <-done
	require.NoError(t, b.err)
	assert.Equal(t, seqOf(t, a)+1, seqOf(t, b.no))
}

// Quotations share one counter.
// Two clients' quotations draw consecutive numbers, whatever their client
// numbers.
func TestQuotationNo_OneCounterAcrossClients(t *testing.T) {
	srv, ctx := resetServer(t)
	t.Cleanup(func() { dropClients(t, docNoClientA, docNoClientB) })

	dropClients(t, docNoClientA, docNoClientB)
	require.NoError(t, insertClient(t, ctx, docNoClientA, "0901"))
	require.NoError(t, insertClient(t, ctx, docNoClientB, "0911"))

	noA := createQuotationFor(t, srv, docNoClientA)
	noB := createQuotationFor(t, srv, docNoClientB)

	assert.Equal(t, seqOf(t, noA)+1, seqOf(t, noB))
}

// createQuotationFor posts a one-line draft.
// It returns the new quotation number.
func createQuotationFor(t *testing.T, srv *httptest.Server, clientID int64) string {
	t.Helper()
	res := doJSON(t, srv, http.MethodPost, "/quotations/", createBody{
		CompanyClientID: clientID,
		DiscountPct:     "0",
		Items:           oneLine("1"),
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var body struct {
		ID int64 `json:"id"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
	return readDetail(t, srv, body.ID).QuotationNo
}
