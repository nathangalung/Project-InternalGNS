package purchaseorders_test

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	seedItemID            int64 = 1
	incompleteVendorID    int64 = 2
	incompleteVendorLabel       = "CV Marine Supply"
)

// Accept a one-vendor catalog quote.
// One catalog item comes from one vendor.
func acceptedQuotationWithVendor(t *testing.T, tx pgx.Tx, companyID int64) int64 {
	t.Helper()
	ctx := context.Background()

	var vendorProductID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		VALUES ($1, $2, 50000, $3, $3)
		RETURNING id`, incompleteVendorID, seedItemID, seedUserID).Scan(&vendorProductID))

	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	offered := seedItemID
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: companyID,
		DiscountPct:     "0",
		Items: []quotations.CreateItem{{
			RequestedName:   "Test Product",
			OfferedItemID:   &offered,
			VendorProductID: &vendorProductID,
			Qty:             "2",
			UnitID:          seedUnitID,
			SellingPrice:    "100000",
			ShipDestination: strPtr("Kapal Uji"),
			CostPrice:       strPtr("50000"),
		}},
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	po, err := purchaseorders.NewRepo(tx, testutil.Store(t)).GetByQuotation(ctx, qid)
	require.NoError(t, err)
	return po.ID
}

// Lines carry their supplying vendor.
// One response carries every line's vendor.
func TestRepo_ListItems_CarriesVendor(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	poID := acceptedQuotationWithVendor(t, tx, seedCompanyID)

	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	require.NotEmpty(t, items)

	require.NotNil(t, items[0].VendorID)
	assert.Equal(t, incompleteVendorID, *items[0].VendorID)
	require.NotNil(t, items[0].VendorName)
	assert.Equal(t, incompleteVendorLabel, *items[0].VendorName)
}

// Server answers the ON_PROGRESS gate.
// It takes one round trip.
func TestRepo_Completeness(t *testing.T) {
	t.Run("complete client and no vendor", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, poID := acceptedQuotationWithPO(t, tx)

		issues, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, poID)
		require.NoError(t, err)
		assert.Empty(t, issues)
	})

	t.Run("incomplete vendor is reported", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		poID := acceptedQuotationWithVendor(t, tx, seedCompanyID)

		issues, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, poID)
		require.NoError(t, err)
		require.Len(t, issues, 1)
		assert.Equal(t, "vendor", issues[0].Scope)
		assert.Equal(t, incompleteVendorID, issues[0].ID)
		assert.Equal(t, []string{"Email atau Nomor Telepon"}, issues[0].Missing)
	})

	t.Run("incomplete client is reported", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		poID := acceptedQuotationForCompany(t, tx, secondCompanyID)

		issues, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, poID)
		require.NoError(t, err)
		require.Len(t, issues, 1)
		assert.Equal(t, "klien", issues[0].Scope)
		assert.Equal(t, secondCompanyID, issues[0].ID)
		assert.Equal(t, []string{
			"NPWP", "Alamat", "Nama Narahubung", "Email atau Nomor Telepon Narahubung",
		}, issues[0].Missing)
	})

	t.Run("unknown PO is not found", func(t *testing.T) {
		ctx, tx := testutil.BeginTx(t)
		_, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, 99999999)
		assert.ErrorIs(t, err, purchaseorders.ErrNotFound)
	})
}

// insertContact adds a client contact.
func insertContact(t *testing.T, tx pgx.Tx, companyID int64, name string, email *string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, tx.QueryRow(context.Background(), `
		INSERT INTO company_contacts (company_id, name, email, country_code, created_by, updated_by)
		VALUES ($1, $2, $3, 'IDN', $4, $4)
		RETURNING id`, companyID, name, email, seedUserID).Scan(&id))
	return id
}

// quoteLine is one addressed line.
func quoteLine(ship *string) quotations.CreateItem {
	return quotations.CreateItem{
		RequestedName: "Test Product", Qty: "1", UnitID: seedUnitID,
		SellingPrice: "100000", ShipDestination: ship,
	}
}

// Gate checks the quotation's contact.
// It falls back to the first active contact only when none was chosen.
func TestRepo_Completeness_ChosenContact(t *testing.T) {
	tests := []struct {
		name       string
		email      *string
		deactivate bool
		want       []string
	}{
		{"chosen contact without a channel", nil, false, []string{"Email atau Nomor Telepon Narahubung"}},
		{"chosen contact complete", strPtr("pilihan@gns.test"), false, nil},
		{"chosen contact deactivated", strPtr("pilihan@gns.test"), true, []string{"Narahubung aktif"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			contactID := insertContact(t, tx, seedCompanyID, "Ibu Pilihan", tc.email)
			_, poID := createQuotation(t, tx, quotations.CreateRequest{
				CompanyClientID: seedCompanyID, ContactID: &contactID, DiscountPct: "0",
				Items: []quotations.CreateItem{quoteLine(strPtr("Kapal Uji"))},
			})
			if tc.deactivate {
				_, err := tx.Exec(ctx, `UPDATE company_contacts SET is_active = FALSE WHERE id = $1`, contactID)
				require.NoError(t, err)
			}

			issues, err := purchaseorders.NewRepo(tx, testutil.Store(t)).Completeness(ctx, poID)
			require.NoError(t, err)
			if tc.want == nil {
				assert.Empty(t, issues)
				return
			}
			require.Len(t, issues, 1)
			assert.Equal(t, "klien", issues[0].Scope)
			assert.Equal(t, tc.want, issues[0].Missing)
		})
	}
}

// Unaddressed goods block the gate.
// The shipping line's address covers every product; without it, each
// product line must carry its own.
func TestRepo_Completeness_ShipDestination(t *testing.T) {
	days := 5
	tests := []struct {
		name    string
		address *string
		cost    *string
		lines   []quotations.CreateItem
		gap     bool
	}{
		{"products addressed, no shipping line", nil, nil,
			[]quotations.CreateItem{quoteLine(strPtr("Kapal Uji")), quoteLine(strPtr("Kapal Dua"))}, false},
		{"blank product, no shipping line", nil, nil,
			[]quotations.CreateItem{quoteLine(strPtr("Kapal Uji")), quoteLine(strPtr("  "))}, true},
		{"blank product, shipping line without address", nil, strPtr("75000"),
			[]quotations.CreateItem{quoteLine(nil)}, true},
		{"blank product, addressed shipping line", strPtr("Jl. Pelabuhan No. 1, Jakarta Utara"), strPtr("75000"),
			[]quotations.CreateItem{quoteLine(nil)}, false},
		{"blank product, addressed shipping line without cost", strPtr("Jl. Pelabuhan No. 1, Jakarta Utara"), nil,
			[]quotations.CreateItem{quoteLine(nil)}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			_, poID := createQuotation(t, tx, quotations.CreateRequest{
				CompanyClientID: seedCompanyID, DiscountPct: "0",
				ShippingAddress: tc.address, ShippingDays: &days, ShippingCost: tc.cost,
				Items: tc.lines,
			})
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))
			if tc.address != nil {
				// The PO snapshot carries the quotation's address.
				items, err := repo.ListItems(ctx, poID)
				require.NoError(t, err)
				ship := items[len(items)-1]
				assert.Equal(t, "shipping", ship.ItemType)
				assert.Equal(t, tc.address, ship.ShipDestination)
			}
			issues, err := repo.Completeness(ctx, poID)
			require.NoError(t, err)
			if !tc.gap {
				assert.Empty(t, issues)
				return
			}
			assert.Equal(t, []purchaseorders.CompletenessIssue{
				{Scope: "pengiriman", ID: poID, Missing: []string{"Alamat Pengiriman"}},
			}, issues)
		})
	}
}

// Addressless quote passes once filled.
// The quotation is accepted with no client address, no vendor location and
// a shipping charge without an address; the gate lists all three, and each
// fill clears one.
func TestHandler_OnProgressGate_FillsAddresses(t *testing.T) {
	ctx, tx, srv := txServer(t)
	clientID, _ := probeClient(t, tx, "PT Tanpa Alamat")
	_, err := tx.Exec(ctx, `UPDATE company_client SET npwp = '0612345678901000' WHERE id = $1`, clientID)
	require.NoError(t, err)
	contactID := insertContact(t, tx, clientID, "Bp. Tanpa Alamat", strPtr("tanpa.alamat@gns.test"))

	var vendorID, vendorProductID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO vendors (name, contact_info, created_by, updated_by)
		VALUES ('CV Tanpa Lokasi', '{"email":"cv@gns.test"}', $1, $1)
		RETURNING id`, seedUserID).Scan(&vendorID))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
		VALUES ($1, $2, 50000, $3, $3)
		RETURNING id`, vendorID, seedItemID, seedUserID).Scan(&vendorProductID))

	offered, days := seedItemID, 5
	_, poID := createQuotation(t, tx, quotations.CreateRequest{
		CompanyClientID: clientID, ContactID: &contactID, DiscountPct: "0",
		ShippingDays: &days, ShippingCost: strPtr("75000"),
		Items: []quotations.CreateItem{{
			RequestedName: "Test Product", OfferedItemID: &offered, VendorProductID: &vendorProductID,
			Qty: "2", UnitID: seedUnitID, SellingPrice: "100000", CostPrice: strPtr("50000"),
		}},
	})
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	require.NoError(t, repo.UpdateFile(ctx, poID, ownedPOFile(poID), seedUserID))
	items, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	require.Len(t, items, 2)
	shipKey := fmt.Sprintf("pengiriman:%d", poID)
	clientKey := fmt.Sprintf("klien:%d", clientID)
	vendorKey := fmt.Sprintf("vendor:%d", vendorID)

	promote := func() *http.Response {
		return doJSON(t, srv, http.MethodPatch, fmt.Sprintf("/purchase-orders/%d/status", poID),
			purchaseorders.ChangeStatusRequest{Status: purchaseorders.StatusOnProgress})
	}
	refused := func(want map[string]string) {
		t.Helper()
		res := promote()
		defer res.Body.Close()
		require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
		assert.Equal(t, want, readProblem(t, res).Fields)
	}

	refused(map[string]string{
		clientKey: "Data klien PT Tanpa Alamat belum lengkap: Alamat",
		vendorKey: "Data vendor CV Tanpa Lokasi belum lengkap: Lokasi",
		shipKey:   "Alamat pengiriman belum diisi",
	})

	_, err = tx.Exec(ctx, `UPDATE company_client SET address = 'Jl. Pelabuhan No. 1, Jakarta Utara' WHERE id = $1`, clientID)
	require.NoError(t, err)
	refused(map[string]string{
		vendorKey: "Data vendor CV Tanpa Lokasi belum lengkap: Lokasi",
		shipKey:   "Alamat pengiriman belum diisi",
	})

	_, err = tx.Exec(ctx, `UPDATE vendors SET location = 'Surabaya' WHERE id = $1`, vendorID)
	require.NoError(t, err)
	refused(map[string]string{shipKey: "Alamat pengiriman belum diisi"})

	// The PO editor sends the address with the stored days and cost.
	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	line := items[0]
	edit := purchaseorders.UpdateItemsRequest{
		DiscountPct:     "0",
		ShippingAddress: strPtr("Kapal Uji, Dermaga 3, Tanjung Priok"),
		ShippingDays:    &days,
		ShippingCost:    strPtr("75000"),
		Items: []purchaseorders.UpdateItemsLine{{
			QuotationItemID: line.QuotationItemID, OfferedItemID: line.OfferedItemID,
			ItemName: line.ItemName, Qty: line.Qty, UnitID: line.UnitID,
			SellingPrice: line.SellingPrice, CostPrice: line.CostPrice,
		}},
	}
	res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
		edit, map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion))})
	res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)

	res = promote()
	res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)
	po, err = repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, purchaseorders.StatusOnProgress, po.Status)

	// The charge survives the address fill.
	items, err = repo.ListItems(ctx, poID)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.Equal(t, "shipping", items[1].ItemType)
	assert.Equal(t, "75000.00", items[1].SellingPrice)
	assert.Equal(t, &days, items[1].ShippingDays)
}
