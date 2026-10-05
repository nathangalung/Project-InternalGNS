package migrations_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const yearlyMigration = "00101_yearly_document_numbers.sql"

// docFixture inserts numbered rows.
type docFixture struct {
	ctx context.Context
	tx  pgx.Tx
	t   *testing.T
}

// quotation inserts one quotation.
func (f docFixture) quotation(no string, version int, parent *int64, legacy, notes *string) int64 {
	f.t.Helper()
	var id int64
	require.NoError(f.t, f.tx.QueryRow(f.ctx, `
		INSERT INTO quotations (quotation_no, version, parent_id, company_client_id, company_client_name,
		                        discount_pct, status, legacy_no, notes, created_by, updated_by)
		VALUES ($1, $2, $3, 1, 'PT Migrasi 00101', 0, 'sent', $4, $5, 1, 1) RETURNING id`,
		no, version, parent, legacy, notes).Scan(&id))
	return id
}

// po inserts one delivered PO.
func (f docFixture) po(quotationID int64, dn string, legacy, notes *string) int64 {
	f.t.Helper()
	var id int64
	require.NoError(f.t, f.tx.QueryRow(f.ctx, `
		INSERT INTO purchase_orders (quotation_id, company_client_id, po_date, discount_pct, status,
		                             delivery_note_number, delivery_note_date, legacy_dn_no, notes,
		                             created_by, updated_by)
		VALUES ($1, 1, CURRENT_DATE, 0, 'DELIVERED', $2, CURRENT_DATE, $3, $4, 1, 1) RETURNING id`,
		quotationID, dn, legacy, notes).Scan(&id))
	return id
}

// invoice inserts one invoice.
func (f docFixture) invoice(no string, quotationID, poID int64, status string, replaces *int64, legacy *string) int64 {
	f.t.Helper()
	var id int64
	require.NoError(f.t, f.tx.QueryRow(f.ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, po_id, company_client_id, buyer_name, invoice_date,
		                      status, replaces_invoice_id, legacy_no, created_by, updated_by)
		VALUES ($1, $2, $3, 1, 'PT Migrasi 00101', CURRENT_DATE, $4, $5, $6, 1, 1) RETURNING id`,
		no, quotationID, poID, status, replaces, legacy).Scan(&id))
	return id
}

// text reads one text value.
func (f docFixture) text(query string, args ...any) string {
	f.t.Helper()
	var s string
	require.NoError(f.t, f.tx.QueryRow(f.ctx, query, args...).Scan(&s))
	return s
}

// version reads row_version and updated_at.
func (f docFixture) version(table string, id int64) string {
	return f.text(`SELECT row_version || ' ' || updated_at FROM `+table+` WHERE id = $1`, id)
}

// counters reads every yearly counter.
func (f docFixture) counters() map[string]int {
	f.t.Helper()
	rows, err := f.tx.Query(f.ctx, `SELECT doc_type || ' ' || year, last_seq FROM doc_counters`)
	require.NoError(f.t, err)
	out := map[string]int{}
	for rows.Next() {
		var k string
		var v int
		require.NoError(f.t, rows.Scan(&k, &v))
		out[k] = v
	}
	require.NoError(f.t, rows.Err())
	return out
}

func ptr[T any](v T) *T { return &v }

// Numbers restart per year.
// Each type is renumbered within the year its number prints, in the order
// of the old running number; revisions follow their base, notes that copy
// a number follow it, and legacy numbers, legacy tokens in notes and old
// format numbers stay. Counters start after each year's highest number.
func TestMigration00101_RenumbersPerYear(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	f := docFixture{ctx: ctx, tx: tx, t: t}
	_, err := tx.Exec(ctx, downSQL(t, yearlyMigration))
	require.NoError(t, err)

	// One running number across 2031 and 2032, inserted out of order.
	qd := f.quotation("Q-90007/GNS/II/2032", 1, nil, nil, ptr("Dipesan bersama Q-90003/GNS/XII/2031"))
	qa := f.quotation("Q-90001/GNS/XI/2031", 1, nil, ptr("Q-310901/GNS/XI/2031"), nil)
	qaRev := f.quotation("Q-90001/GNS/XI/2031 Rev.1", 2, &qa, nil, nil)
	qb := f.quotation("Q-90003/GNS/XII/2031", 1, nil, nil,
		ptr("Juga tercatat dengan No. Q-310902/GNS/XII/2031; lihat Q-90007/GNS/II/2032"))
	qc := f.quotation("Q-90004/GNS/I/2032", 1, nil, nil, nil)
	qcRev1 := f.quotation("Q-90004/GNS/I/2032 Rev.1", 2, &qc, nil, nil)
	qcRev2 := f.quotation("Q-90004/GNS/I/2032 Rev.2", 3, &qcRev1, nil, nil)
	qOld := f.quotation("Q-3109011/GNS/XI/2031", 1, nil, nil, nil)
	_, err = tx.Exec(ctx, `
		INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by) VALUES
		  ($1, 'draft', 'sent', 'Direvisi menjadi Q-90004/GNS/I/2032 Rev.1', 1),
		  ($2, NULL, 'draft', 'Revisi dari Q-90004/GNS/I/2032 Rev.1', 1),
		  ($3, 'sent', 'rejected', 'Ganti Q-99999/GNS/I/2032 dan XQ-90001/GNS/XI/2031', 1)`,
		qc, qcRev2, qd)
	require.NoError(t, err)

	poA := f.po(qa, "DN-90020/GNS/XII/2031", ptr("001/DO-GNS/XII/2031"),
		ptr("Baris 1 berasal dari Q-90003/GNS/XII/2031 (Q-310902/GNS/XII/2031)"))
	poC := f.po(qcRev2, "DN-90022/GNS/II/2032", nil, nil)
	poD := f.po(qd, "DN-90021/GNS/I/2032", nil, nil)
	_, err = tx.Exec(ctx, `
		INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
		VALUES ($1, 'ON_PROGRESS', 'DELIVERED', 'Surat jalan DN-90022/GNS/II/2032', 1)`, poC)
	require.NoError(t, err)

	inv1 := f.invoice("INV-90010/GNS/XII/2031", qa, poA, "paid", nil, ptr("001/INV-GNS/XII/2031"))
	inv2 := f.invoice("INV-90011/GNS/I/2032", qcRev2, poC, "cancelled", nil, nil)
	inv3 := f.invoice("INV-90012/GNS/I/2032", qcRev2, poC, "draft", &inv2, nil)
	_, err = tx.Exec(ctx, `
		INSERT INTO invoice_status_history (invoice_id, from_status, to_status, note, changed_by)
		VALUES ($1, 'draft', 'cancelled', 'Diganti INV-90012/GNS/I/2032 untuk DN-90022/GNS/II/2032', 1)`, inv2)
	require.NoError(t, err)

	before := map[string]string{
		"qa": f.version("quotations", qa), "poA": f.version("purchase_orders", poA),
		"inv1": f.version("invoices", inv1),
	}

	_, err = tx.Exec(ctx, upSQL(t, yearlyMigration))
	require.NoError(t, err)

	quotationNo := func(id int64) string { return f.text(`SELECT quotation_no FROM quotations WHERE id = $1`, id) }
	assert.Equal(t, "Q-00001/GNS/XI/2031", quotationNo(qa))
	assert.Equal(t, "Q-00001/GNS/XI/2031 Rev.1", quotationNo(qaRev))
	assert.Equal(t, "Q-00002/GNS/XII/2031", quotationNo(qb))
	assert.Equal(t, "Q-00001/GNS/I/2032", quotationNo(qc))
	assert.Equal(t, "Q-00001/GNS/I/2032 Rev.1", quotationNo(qcRev1))
	assert.Equal(t, "Q-00001/GNS/I/2032 Rev.2", quotationNo(qcRev2))
	assert.Equal(t, "Q-00002/GNS/II/2032", quotationNo(qd))
	assert.Equal(t, "Q-3109011/GNS/XI/2031", quotationNo(qOld), "an old-format number stays")

	invoiceNo := func(id int64) string { return f.text(`SELECT invoice_no FROM invoices WHERE id = $1`, id) }
	assert.Equal(t, "INV-00001/GNS/XII/2031", invoiceNo(inv1))
	assert.Equal(t, "INV-00001/GNS/I/2032", invoiceNo(inv2))
	assert.Equal(t, "INV-00002/GNS/I/2032", invoiceNo(inv3))

	dnNo := func(id int64) string {
		return f.text(`SELECT delivery_note_number FROM purchase_orders WHERE id = $1`, id)
	}
	assert.Equal(t, "DN-00001/GNS/XII/2031", dnNo(poA))
	assert.Equal(t, "DN-00001/GNS/I/2032", dnNo(poD))
	assert.Equal(t, "DN-00002/GNS/II/2032", dnNo(poC))

	// Copied numbers follow; legacy ones stay.
	assert.Equal(t, "Dipesan bersama Q-00002/GNS/XII/2031", f.text(`SELECT notes FROM quotations WHERE id = $1`, qd))
	assert.Equal(t, "Juga tercatat dengan No. Q-310902/GNS/XII/2031; lihat Q-00002/GNS/II/2032",
		f.text(`SELECT notes FROM quotations WHERE id = $1`, qb))
	assert.Equal(t, "Q-310901/GNS/XI/2031", f.text(`SELECT legacy_no FROM quotations WHERE id = $1`, qa))
	history := func(table, key string, id int64, to string) string {
		return f.text(`SELECT note FROM `+table+` WHERE `+key+` = $1 AND to_status = $2
		               AND from_status IS NOT NULL`, id, to)
	}
	assert.Equal(t, "Direvisi menjadi Q-00001/GNS/I/2032 Rev.1", history("quotation_status_history", "quotation_id", qc, "sent"))
	assert.Equal(t, "Revisi dari Q-00001/GNS/I/2032 Rev.1",
		f.text(`SELECT note FROM quotation_status_history WHERE quotation_id = $1 AND note LIKE 'Revisi%'`, qcRev2))
	assert.Equal(t, "Ganti Q-99999/GNS/I/2032 dan XQ-90001/GNS/XI/2031",
		history("quotation_status_history", "quotation_id", qd, "rejected"), "unknown and embedded tokens stay")
	assert.Equal(t, "Baris 1 berasal dari Q-00002/GNS/XII/2031 (Q-310902/GNS/XII/2031)",
		f.text(`SELECT notes FROM purchase_orders WHERE id = $1`, poA))
	assert.Equal(t, "001/DO-GNS/XII/2031", f.text(`SELECT legacy_dn_no FROM purchase_orders WHERE id = $1`, poA))
	assert.Equal(t, "Surat jalan DN-00002/GNS/II/2032", history("po_status_history", "po_id", poC, "DELIVERED"))
	assert.Equal(t, "Diganti INV-00002/GNS/I/2032 untuk DN-00002/GNS/II/2032",
		history("invoice_status_history", "invoice_id", inv2, "cancelled"))
	assert.Equal(t, "001/INV-GNS/XII/2031", f.text(`SELECT legacy_no FROM invoices WHERE id = $1`, inv1))

	// Renumbering is no edit.
	assert.Equal(t, before["qa"], f.version("quotations", qa))
	assert.Equal(t, before["poA"], f.version("purchase_orders", poA))
	assert.Equal(t, before["inv1"], f.version("invoices", inv1))

	counters := f.counters()
	for k, want := range map[string]int{
		"Q 2031": 2, "Q 2032": 2, "INV 2031": 1, "INV 2032": 2, "DN 2031": 1, "DN 2032": 2,
	} {
		assert.Equal(t, want, counters[k], "counter %s", k)
	}

	// Down then Up keeps every number.
	_, err = tx.Exec(ctx, downSQL(t, yearlyMigration))
	require.NoError(t, err)
	_, err = tx.Exec(ctx, upSQL(t, yearlyMigration))
	require.NoError(t, err)
	assert.Equal(t, "Q-00002/GNS/II/2032", quotationNo(qd))
	assert.Equal(t, "Q-00001/GNS/I/2032 Rev.2", quotationNo(qcRev2))
	assert.Equal(t, "INV-00002/GNS/I/2032", invoiceNo(inv3))
	assert.Equal(t, "DN-00002/GNS/II/2032", dnNo(poC))
	assert.Equal(t, counters, f.counters())
}

// Down keeps numbers unique.
// The one counter per type resumes above every number of every year, so
// the next number is new.
func TestMigration00101_DownResumesAboveEveryYear(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	f := docFixture{ctx: ctx, tx: tx, t: t}
	f.quotation("Q-00412/GNS/III/2031", 1, nil, nil, nil)
	f.quotation("Q-00007/GNS/I/2032", 1, nil, nil, nil)
	_, err := tx.Exec(ctx, `
		INSERT INTO doc_counters (doc_type, year, last_seq) VALUES ('Q', 2031, 412), ('INV', 2033, 950)
		ON CONFLICT (doc_type, year) DO UPDATE SET last_seq = GREATEST(doc_counters.last_seq, EXCLUDED.last_seq)`)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, downSQL(t, yearlyMigration))
	require.NoError(t, err)

	var highest int
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT max(substring(quotation_no FROM '^Q-([0-9]{5,6})/GNS/[IVX]+/[0-9]{4}')::int) FROM quotations`).Scan(&highest))
	var q, inv int
	require.NoError(t, tx.QueryRow(ctx, `SELECT last_seq FROM doc_counters WHERE doc_type = 'Q'`).Scan(&q))
	require.NoError(t, tx.QueryRow(ctx, `SELECT last_seq FROM doc_counters WHERE doc_type = 'INV'`).Scan(&inv))
	assert.GreaterOrEqual(t, q, highest)
	assert.GreaterOrEqual(t, q, 412)
	assert.GreaterOrEqual(t, inv, 950, "a counter above its numbers is kept")

	next := f.text(`SELECT fn_next_doc_no('Q')`)
	var taken bool
	require.NoError(t, tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM quotations WHERE quotation_no = $1)`, next).Scan(&taken))
	assert.False(t, taken, "%s is already taken", next)
	assert.Regexp(t, `^Q-[0-9]{5,}/GNS/`, next)
}
