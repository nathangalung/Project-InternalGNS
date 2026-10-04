package invoices_test

import (
	"context"
	"encoding/xml"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// buyer is the invoiced party.
type buyer struct {
	name, npwp, address string
}

var movedBuyer = buyer{name: "PT Pindah Alamat", npwp: "1111222233334444", address: "Jl. Baru No. 9"}

// clientBuyer reads the seed client.
func clientBuyer(t *testing.T, tx pgx.Tx) buyer {
	t.Helper()
	var b buyer
	require.NoError(t, tx.QueryRow(context.Background(), `
		SELECT name, COALESCE(npwp, ''), COALESCE(address, '') FROM company_client WHERE id = $1`,
		seedCompanyID).Scan(&b.name, &b.npwp, &b.address))
	return b
}

// moveClient edits the seed client.
func moveClient(t *testing.T, tx pgx.Tx, b buyer) {
	t.Helper()
	_, err := tx.Exec(context.Background(), `
		UPDATE company_client SET name = $2, npwp = NULLIF($3, ''), address = $4 WHERE id = $1`,
		seedCompanyID, b.name, b.npwp, b.address)
	require.NoError(t, err)
}

// invoicedBuyer reads one invoice's party.
func invoicedBuyer(t *testing.T, repo *invoices.Repo, id int64) buyer {
	t.Helper()
	det, err := repo.GetDetail(context.Background(), id)
	require.NoError(t, err)
	byID, err := repo.GetByID(context.Background(), id)
	require.NoError(t, err)
	assert.Equal(t, det.CompanyName, byID.CompanyName, "detail and row agree")
	assert.Equal(t, det.CompanyNpwp, byID.CompanyNpwp, "detail and row agree")
	assert.Equal(t, det.CompanyAddress, byID.CompanyAddress, "detail and row agree")
	deref := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	return buyer{name: det.CompanyName, npwp: deref(det.CompanyNpwp), address: deref(det.CompanyAddress)}
}

// Invoices keep their buyer.
// A client edit never restates an invoice, draft or issued, and never
// bumps its row_version; a Pengganti takes the client as it is when the
// Pengganti is issued.
func TestInvoice_BuyerSnapshot(t *testing.T) {
	reason := "Salah alamat penagihan"
	cancel := invoices.ChangeStatusRequest{Status: invoices.StatusCancelled, Note: &reason}

	t.Run("a sent invoice keeps the buyer it went out to", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, _, invID := deliveredPOWithInvoice(t, tx)
		repo := invoices.NewRepo(tx, testutil.Store(t))
		before := clientBuyer(t, tx)
		require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusSent), seedUserID))

		moveClient(t, tx, movedBuyer)
		assert.Equal(t, before, invoicedBuyer(t, repo, invID))

		// The client's current name still finds the invoice.
		list, err := repo.List(ctx, invoices.ListFilter{Q: movedBuyer.name, Limit: 50})
		require.NoError(t, err)
		ids := make([]int64, 0, len(list.Rows))
		for _, row := range list.Rows {
			ids = append(ids, row.ID)
			if row.ID == invID {
				assert.Equal(t, before.name, row.CompanyName)
			}
		}
		assert.Contains(t, ids, invID)
	})

	t.Run("a draft keeps its buyer", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, _, invID := deliveredPOWithInvoice(t, tx)
		repo := invoices.NewRepo(tx, testutil.Store(t))
		before := clientBuyer(t, tx)
		draft, err := repo.GetByID(ctx, invID)
		require.NoError(t, err)

		moveClient(t, tx, movedBuyer)
		assert.Equal(t, before, invoicedBuyer(t, repo, invID))
		after, err := repo.GetByID(ctx, invID)
		require.NoError(t, err)
		assert.Equal(t, draft.RowVersion, after.RowVersion, "an open date edit stays current")
	})

	t.Run("a pengganti takes the client at its issue", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, _, invID := deliveredPOWithInvoice(t, tx)
		repo := invoices.NewRepo(tx, testutil.Store(t))
		before := clientBuyer(t, tx)
		require.NoError(t, repo.ChangeStatus(ctx, invID, move(invoices.StatusSent), seedUserID))
		require.NoError(t, repo.ChangeStatus(ctx, invID, cancel, seedUserID))

		moveClient(t, tx, movedBuyer)
		det, err := repo.Replace(ctx, invID, seedUserID)
		require.NoError(t, err)

		assert.Equal(t, movedBuyer, invoicedBuyer(t, repo, det.ID))
		assert.Equal(t, before, invoicedBuyer(t, repo, invID))
	})
}

// Coretax files the invoiced buyer.
// A sent invoice is filed with the NPWP and address it went out with, and
// one sent without an NPWP is refused with the Pengganti route, since
// completing the client no longer reaches it.
func TestCoretaxExport_FilesTheInvoicedBuyer(t *testing.T) {
	t.Run("a later client edit is not filed", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, _, invID := deliveredPOWithInvoice(t, tx)
		before := clientBuyer(t, tx)
		require.NoError(t, invoices.NewRepo(tx, testutil.Store(t)).ChangeStatus(
			ctx, invID, move(invoices.StatusSent), seedUserID))
		moveClient(t, tx, movedBuyer)

		rec := exportCoretaxXML(t, tx, invID)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var filed struct {
			Name    string `xml:"ListOfTaxInvoice>TaxInvoice>BuyerName"`
			Address string `xml:"ListOfTaxInvoice>TaxInvoice>BuyerAdress"`
			Tin     string `xml:"ListOfTaxInvoice>TaxInvoice>BuyerTin"`
		}
		require.NoError(t, xml.Unmarshal(rec.Body.Bytes(), &filed))
		assert.Equal(t, before.name, filed.Name)
		assert.Equal(t, before.address, filed.Address)
		assert.NotEqual(t, movedBuyer.npwp, filed.Tin)
	})

	t.Run("an invoice without an NPWP needs a pengganti", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, _, invID := deliveredPOWithInvoice(t, tx)
		repo := invoices.NewRepo(tx, testutil.Store(t))
		// A legacy row backfilled from a client with no NPWP.
		_, err := tx.Exec(ctx, `UPDATE invoices SET buyer_npwp = NULL WHERE id = $1`, invID)
		require.NoError(t, err)
		moveClient(t, tx, movedBuyer)
		inv, err := repo.GetByID(ctx, invID)
		require.NoError(t, err)

		rec := exportCoretaxXML(t, tx, invID)
		require.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
		assert.Equal(t,
			"Ekspor Coretax memerlukan NPWP 16 digit untuk pembeli Indonesia. "+
				"Invoice memakai data klien saat invoice dibuat, jadi lengkapi NPWP klien, "+
				"lalu batalkan dan terbitkan invoice pengganti untuk: "+inv.InvoiceNo+".",
			problemDetail(t, rec))
	})
}
