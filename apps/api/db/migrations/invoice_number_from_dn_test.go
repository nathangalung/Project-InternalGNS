package migrations_test

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const invoiceFromDNMigration = "00120_invoice_number_from_dn.sql"

// deliveredPO adds a quotation and its PO.
// It returns both ids; each PO needs its own quotation.
func (f docFixture) deliveredPO(qno, dn string) (int64, int64) {
	f.t.Helper()
	q := f.quotation(qno, 1, nil, nil, nil)
	return q, f.po(q, dn, nil, nil)
}

// invoiceWithoutPO adds a PO-less invoice.
func (f docFixture) invoiceWithoutPO(no string, quotationID int64) int64 {
	f.t.Helper()
	var id int64
	require.NoError(f.t, f.tx.QueryRow(f.ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id, buyer_name, invoice_date,
		                      status, created_by, updated_by)
		VALUES ($1, $2, 1, 'PT Migrasi 00120', CURRENT_DATE, 'paid', 1, 1) RETURNING id`,
		no, quotationID).Scan(&id))
	return id
}

// refusedBy runs one statement in a savepoint.
// It returns the unique index that refused it, or "" when it passed.
func (f docFixture) refusedBy(query string, args ...any) string {
	f.t.Helper()
	sp, err := f.tx.Begin(f.ctx)
	require.NoError(f.t, err)
	defer func() { _ = sp.Rollback(f.ctx) }()
	_, err = sp.Exec(f.ctx, query, args...)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return pgErr.ConstraintName
	}
	require.NoError(f.t, err)
	return ""
}

// Invoices take their note's number.
// Each invoice of a PO with a current-format note is renumbered after it,
// oldest first, a Pengganti with Rev.n. A changed number moves into an
// empty legacy_no, notes that copy it follow, and invoices whose note is
// older keep theirs. No row counts as edited.
func TestMigration00120_InvoicesTakeTheirNote(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	f := docFixture{ctx: ctx, tx: tx, t: t}
	_, err := tx.Exec(ctx, downSQL(t, invoiceFromDNMigration))
	require.NoError(t, err)

	qA, poA := f.deliveredPO("Q-91001/GNS/X/2031", "DN-90071/GNS/X/2031")
	invA := f.invoice("INV-90072/GNS/X/2031", qA, poA, "sent", nil, nil)

	// A Pengganti chain.
	qB, poB := f.deliveredPO("Q-91002/GNS/X/2031", "DN-90076/GNS/X/2031")
	invB1 := f.invoice("INV-90077/GNS/X/2031", qB, poB, "cancelled", nil, nil)
	invB2 := f.invoice("INV-90083/GNS/X/2031", qB, poB, "cancelled", &invB1, nil)
	invB3 := f.invoice("INV-90084/GNS/XI/2031", qB, poB, "draft", &invB2, nil)
	_, err = tx.Exec(ctx, `
		INSERT INTO invoice_status_history (invoice_id, from_status, to_status, note, changed_by)
		VALUES ($1, 'sent', 'cancelled', 'Diganti INV-90083/GNS/X/2031, bukan INV-90999/GNS/X/2031', 1)`, invB1)
	require.NoError(t, err)

	// An imported invoice keeps the number the client received.
	qC, poC := f.deliveredPO("Q-91003/GNS/X/2031", "DN-90080/GNS/XI/2031")
	invC := f.invoice("INV-90081/GNS/XI/2031", qC, poC, "paid", nil, ptr("001/INV-GNS/XI/2031"))

	// Two invoices trade numbers.
	qX, poX := f.deliveredPO("Q-91004/GNS/X/2031", "DN-90100/GNS/XII/2031")
	qY, poY := f.deliveredPO("Q-91005/GNS/X/2031", "DN-90101/GNS/XII/2031")
	invX := f.invoice("INV-90101/GNS/XII/2031", qX, poX, "sent", nil, nil)
	invY := f.invoice("INV-90100/GNS/XII/2031", qY, poY, "sent", nil, nil)

	// Already matching, and an older note.
	qM, poM := f.deliveredPO("Q-91006/GNS/X/2031", "DN-90095/GNS/XI/2031")
	invM := f.invoice("INV-90095/GNS/XI/2031", qM, poM, "sent", nil, nil)
	qOld, poOld := f.deliveredPO("Q-91007/GNS/X/2031", "0042/DO-GNS/X/2025")
	invOld := f.invoice("INV-90090/GNS/X/2031", qOld, poOld, "paid", nil, nil)

	// An older note's chain drew two numbers.
	qOld2, poOld2 := f.deliveredPO("Q-91010/GNS/X/2031", "0044/DO-GNS/IX/2025")
	invOld1 := f.invoice("INV-90091/GNS/X/2031", qOld2, poOld2, "cancelled", nil, nil)
	invOld2 := f.invoice("INV-90093/GNS/X/2031", qOld2, poOld2, "draft", &invOld1, nil)

	before := map[int64]string{invA: f.version("invoices", invA), invB3: f.version("invoices", invB3)}

	_, err = tx.Exec(ctx, upSQL(t, invoiceFromDNMigration))
	require.NoError(t, err)

	invoiceNo := func(id int64) string { return f.text(`SELECT invoice_no FROM invoices WHERE id = $1`, id) }
	legacyNo := func(id int64) string {
		return f.text(`SELECT COALESCE(legacy_no, '') FROM invoices WHERE id = $1`, id)
	}
	for _, c := range []struct {
		name       string
		id         int64
		no, legacy string
	}{
		{"first invoice", invA, "INV-90071/GNS/X/2031", "INV-90072/GNS/X/2031"},
		{"chain root", invB1, "INV-90076/GNS/X/2031", "INV-90077/GNS/X/2031"},
		{"first pengganti", invB2, "INV-90076/GNS/X/2031 Rev.1", "INV-90083/GNS/X/2031"},
		{"second pengganti", invB3, "INV-90076/GNS/X/2031 Rev.2", "INV-90084/GNS/XI/2031"},
		{"imported", invC, "INV-90080/GNS/XI/2031", "001/INV-GNS/XI/2031"},
		{"traded x", invX, "INV-90100/GNS/XII/2031", "INV-90101/GNS/XII/2031"},
		{"traded y", invY, "INV-90101/GNS/XII/2031", "INV-90100/GNS/XII/2031"},
		{"already matching", invM, "INV-90095/GNS/XI/2031", ""},
		{"older note", invOld, "INV-90090/GNS/X/2031", ""},
		{"older note chain root", invOld1, "INV-90091/GNS/X/2031", ""},
		{"older note pengganti", invOld2, "INV-90091/GNS/X/2031 Rev.1", "INV-90093/GNS/X/2031"},
	} {
		assert.Equal(t, c.no, invoiceNo(c.id), c.name)
		assert.Equal(t, c.legacy, legacyNo(c.id), "%s legacy_no", c.name)
	}

	assert.Equal(t, "Diganti INV-90076/GNS/X/2031 Rev.1, bukan INV-90999/GNS/X/2031",
		f.text(`SELECT note FROM invoice_status_history WHERE invoice_id = $1 AND to_status = 'cancelled'`, invB1),
		"a copied number follows, an unknown one stays")

	// Every PO carries one number.
	fixturePOs := []int64{poA, poB, poC, poX, poY, poM, poOld, poOld2}
	assert.Equal(t, "0", f.text(`
		SELECT count(*)::text FROM (
		  SELECT po_id FROM invoices WHERE po_id = ANY($1)
		  GROUP BY po_id
		  HAVING count(DISTINCT regexp_replace(invoice_no, ' Rev\.[0-9]+$', '')) > 1
		) two`, fixturePOs), "a PO with two base numbers")

	// Renumbering is no edit.
	for id, v := range before {
		assert.Equal(t, v, f.version("invoices", id))
	}

	// The indexes keep it so.
	// Cancelled rows leave uq_invoices_po_id_live out of it.
	assert.Equal(t, "uq_invoices_po_id_base", f.refusedBy(`
		INSERT INTO invoices (invoice_no, quotation_id, po_id, company_client_id, buyer_name, invoice_date,
		                      status, created_by, updated_by)
		VALUES ('INV-90999/GNS/X/2031', $1, $2, 1, 'PT Migrasi 00120', CURRENT_DATE, 'cancelled', 1, 1)`, qA, poA))
	assert.Empty(t, f.refusedBy(`
		INSERT INTO invoices (invoice_no, quotation_id, po_id, company_client_id, buyer_name, invoice_date,
		                      status, created_by, updated_by)
		VALUES ('INV-90071/GNS/X/2031 Rev.1', $1, $2, 1, 'PT Migrasi 00120', CURRENT_DATE, 'cancelled', 1, 1)`, qA, poA),
		"a Pengganti still fits")
	assert.Equal(t, "uq_purchase_orders_delivery_note_number",
		f.refusedBy(`UPDATE purchase_orders SET delivery_note_number = 'DN-90071/GNS/X/2031' WHERE id = $1`, poM))

	// Down then Up keeps every number.
	_, err = tx.Exec(ctx, downSQL(t, invoiceFromDNMigration))
	require.NoError(t, err)
	_, err = tx.Exec(ctx, upSQL(t, invoiceFromDNMigration))
	require.NoError(t, err)
	assert.Equal(t, "INV-90076/GNS/X/2031 Rev.2", invoiceNo(invB3))
	assert.Equal(t, "INV-90072/GNS/X/2031", legacyNo(invA))
}

// A shared number stops the migration.
// Two invoices would end on one number, or two POs share a note, so it
// refuses with the numbers named rather than renumber half.
func TestMigration00120_RefusesClash(t *testing.T) {
	cases := []struct {
		name  string
		setup func(f docFixture)
		want  string
	}{
		{
			name: "an older note's first invoice holds a note's number",
			setup: func(f docFixture) {
				q, po := f.deliveredPO("Q-91008/GNS/X/2031", "0043/DO-GNS/X/2025")
				f.invoice("INV-90200/GNS/X/2031", q, po, "paid", nil, nil)
				q, po = f.deliveredPO("Q-91009/GNS/X/2031", "DN-90200/GNS/X/2031")
				f.invoice("INV-90201/GNS/X/2031", q, po, "sent", nil, nil)
			},
			want: "would share a number: INV-90200/GNS/X/2031 (INV-90200/GNS/X/2031 and INV-90201/GNS/X/2031)",
		},
		{
			name: "an invoice without a PO holds it",
			setup: func(f docFixture) {
				q, po := f.deliveredPO("Q-91011/GNS/X/2031", "DN-90300/GNS/X/2031")
				f.invoice("INV-90301/GNS/X/2031", q, po, "sent", nil, nil)
				f.invoiceWithoutPO("INV-90300/GNS/X/2031", q)
			},
			want: "held by invoices without a PO: INV-90300/GNS/X/2031",
		},
		{
			name: "two POs share a note",
			setup: func(f docFixture) {
				q, po := f.deliveredPO("Q-91012/GNS/X/2031", "DN-90400/GNS/X/2031")
				f.invoice("INV-90401/GNS/X/2031", q, po, "sent", nil, nil)
				q, po = f.deliveredPO("Q-91013/GNS/X/2031", "DN-90400/GNS/X/2031")
				f.invoice("INV-90402/GNS/X/2031", q, po, "sent", nil, nil)
			},
			want: "uq_purchase_orders_delivery_note_number",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			f := docFixture{ctx: ctx, tx: tx, t: t}
			_, err := tx.Exec(ctx, downSQL(t, invoiceFromDNMigration))
			require.NoError(t, err)
			tc.setup(f)
			_, err = tx.Exec(ctx, upSQL(t, invoiceFromDNMigration))
			require.ErrorContains(t, err, tc.want)
		})
	}
}
