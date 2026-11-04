package migrations_test

import (
	"testing"

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
	} {
		assert.Equal(t, c.no, invoiceNo(c.id), c.name)
		assert.Equal(t, c.legacy, legacyNo(c.id), "%s legacy_no", c.name)
	}

	assert.Equal(t, "Diganti INV-90076/GNS/X/2031 Rev.1, bukan INV-90999/GNS/X/2031",
		f.text(`SELECT note FROM invoice_status_history WHERE invoice_id = $1 AND to_status = 'cancelled'`, invB1),
		"a copied number follows, an unknown one stays")

	// Renumbering is no edit.
	for id, v := range before {
		assert.Equal(t, v, f.version("invoices", id))
	}

	// Down then Up keeps every number.
	_, err = tx.Exec(ctx, downSQL(t, invoiceFromDNMigration))
	require.NoError(t, err)
	_, err = tx.Exec(ctx, upSQL(t, invoiceFromDNMigration))
	require.NoError(t, err)
	assert.Equal(t, "INV-90076/GNS/X/2031 Rev.2", invoiceNo(invB3))
	assert.Equal(t, "INV-90072/GNS/X/2031", legacyNo(invA))
}

// A kept number stops the migration.
// An invoice the migration cannot renumber already holds the number a
// renumbered one needs, so it refuses rather than renumber half.
func TestMigration00120_RefusesClash(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	f := docFixture{ctx: ctx, tx: tx, t: t}
	_, err := tx.Exec(ctx, downSQL(t, invoiceFromDNMigration))
	require.NoError(t, err)

	qOld, poOld := f.deliveredPO("Q-91008/GNS/X/2031", "0043/DO-GNS/X/2025")
	f.invoice("INV-90200/GNS/X/2031", qOld, poOld, "paid", nil, nil)
	q, po := f.deliveredPO("Q-91009/GNS/X/2031", "DN-90200/GNS/X/2031")
	f.invoice("INV-90201/GNS/X/2031", q, po, "sent", nil, nil)

	_, err = tx.Exec(ctx, upSQL(t, invoiceFromDNMigration))
	require.ErrorContains(t, err, "INV-90200/GNS/X/2031")
}
