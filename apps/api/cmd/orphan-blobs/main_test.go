package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Every stored invoice key is referenced.
// A payment proof lives in the attachment bucket, so a sweep that only knew
// attachment_object_key would purge every proof.
func TestLoadReferences_InvoiceBucketKeepsProofs(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	var query string
	for _, s := range specs {
		if s.bucket == storage.BucketInvoiceAttachments {
			query = s.query
		}
	}
	require.NotEmpty(t, query)

	var qid, invID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        created_by, updated_by)
		VALUES ('SQ-ORPHAN-1', 1, 'PT. IMC Ship Management', 0, 10000, 10000, 0, 1, 1)
		RETURNING id`).Scan(&qid))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO invoices (invoice_no, quotation_id, company_client_id, invoice_date,
		                      subtotal, dpp, total, status, created_by, updated_by,
		                      attachment_object_key, payment_proof_key)
		VALUES ('INV-ORPHAN-1', $1, 1, CURRENT_DATE, 10000, 10000, 11100, 'paid', 1, 1,
		        'orphan-test/attachment.pdf', 'orphan-test/payment/proof.pdf')
		RETURNING id`, qid).Scan(&invID))
	_, err := tx.Exec(ctx, `
		INSERT INTO invoice_status_history (invoice_id, from_status, to_status, payment_proof_key, changed_by)
		VALUES ($1, 'sent', 'paid', 'orphan-test/payment/earlier.pdf', 1)`, invID)
	require.NoError(t, err)

	refs, err := loadReferences(ctx, tx, query)
	require.NoError(t, err)
	for _, key := range []string{"orphan-test/attachment.pdf", "orphan-test/payment/proof.pdf", "orphan-test/payment/earlier.pdf"} {
		assert.Contains(t, refs, key)
	}
}
