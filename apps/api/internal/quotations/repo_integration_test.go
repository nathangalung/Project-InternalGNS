package quotations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	seedCompanyID  int64 = 1
	seedContactID  int64 = 9000001
	seedItemID     int64 = 9000001
	seedVendorProd int64 = 9000001
	seedUnitID     int16 = 19
	seedUserID     int64 = 1
)

func newRepo(t *testing.T) (context.Context, *quotations.Repo, pgx.Tx) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	return ctx, quotations.NewRepo(tx, store), tx
}

func sampleCreate() quotations.CreateRequest {
	notes := "test"
	pay := "30 days"
	validity := 30
	ref := "PO-001"
	vessel := "MV TEST"
	shipAddr := "Tanjung Priok"
	shipDays := 3
	shipCost := "150000"
	contact := seedContactID
	return quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		ContactID:       &contact,
		ClientRefNo:     &ref,
		VesselName:      &vessel,
		PaymentTerms:    &pay,
		ValidityDays:    &validity,
		DiscountPct:     "10",
		ShippingAddress: &shipAddr,
		ShippingDays:    &shipDays,
		ShippingCost:    &shipCost,
		Notes:           &notes,
		Items: []quotations.CreateItem{
			{
				RequestedItemID: int64Ptr(seedItemID),
				RequestedName:   "PUNCHING TOOL SET",
				VendorProductID: int64Ptr(seedVendorProd),
				Qty:             "2",
				UnitID:          seedUnitID,
				SellingPrice:    "1500000",
			},
		},
	}
}

func TestRepo_CreateAndGetDetail(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	assert.Greater(t, id, int64(0))

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, id, d.ID)
	assert.Equal(t, "draft", d.Status)
	assert.Equal(t, "10.00", d.DiscountPct)
	require.Len(t, d.Items, 2, "1 product + 1 shipping")
	assert.Equal(t, "product", d.Items[0].ItemType)
	assert.Equal(t, "shipping", d.Items[1].ItemType)
}

func TestRepo_Create_RejectsEmptyItems(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	req := sampleCreate()
	req.Items = nil
	_, err := repo.Create(ctx, req, seedUserID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "at least 1 item")
}

func TestRepo_Create_RejectsBadDiscount(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	req := sampleCreate()
	req.DiscountPct = "120"
	_, err := repo.Create(ctx, req, seedUserID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "discount_pct")
}

func TestRepo_Create_RejectsUnknownClient(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	req := sampleCreate()
	req.CompanyClientID = 99999
	_, err := repo.Create(ctx, req, seedUserID)
	require.Error(t, err)
	assert.Contains(t, strings.ToLower(err.Error()), "company_client_id")
}

func TestRepo_GetDetail_NotFound(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	_, err := repo.GetDetail(ctx, 999999)
	assert.ErrorIs(t, err, quotations.ErrNotFound)
}

func TestRepo_Update_DraftAllowed(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	upd := quotations.UpdateRequest{
		DiscountPct: "5",
		Items: []quotations.CreateItem{{
			RequestedName: "BOLT M8",
			Qty:           "10",
			UnitID:        seedUnitID,
			SellingPrice:  "20000",
		}},
	}
	newVersion, err := repo.Update(ctx, id, upd, seedUserID, nil)
	require.NoError(t, err)
	assert.Greater(t, newVersion, int32(0))

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, "5.00", d.DiscountPct)
	assert.Equal(t, newVersion, d.RowVersion)
}

func TestRepo_Update_RejectsNonDraft(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)
	require.NoError(t, repo.ChangeStatus(ctx, id, "sent", nil, seedUserID))

	upd := quotations.UpdateRequest{
		DiscountPct: "5",
		Items: []quotations.CreateItem{{
			RequestedName: "X",
			Qty:           "1",
			UnitID:        seedUnitID,
			SellingPrice:  "1000",
		}},
	}
	_, err = repo.Update(ctx, id, upd, seedUserID, nil)
	require.Error(t, err)
}

func TestRepo_Update_VersionMatch(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	current := d.RowVersion

	upd := quotations.UpdateRequest{
		DiscountPct: "5",
		Items: []quotations.CreateItem{{
			RequestedName: "BOLT M8",
			Qty:           "10",
			UnitID:        seedUnitID,
			SellingPrice:  "20000",
		}},
	}
	newVersion, err := repo.Update(ctx, id, upd, seedUserID, &current)
	require.NoError(t, err)
	assert.Greater(t, newVersion, current)
}

func TestRepo_Update_VersionMismatch(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	stale := int32(999)
	upd := quotations.UpdateRequest{
		DiscountPct: "5",
		Items: []quotations.CreateItem{{
			RequestedName: "BOLT M8",
			Qty:           "10",
			UnitID:        seedUnitID,
			SellingPrice:  "20000",
		}},
	}
	_, err = repo.Update(ctx, id, upd, seedUserID, &stale)
	require.ErrorIs(t, err, quotations.ErrVersionMismatch)
}

func TestRepo_Update_NotFound(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	zero := int32(0)
	upd := quotations.UpdateRequest{
		DiscountPct: "5",
		Items: []quotations.CreateItem{{
			RequestedName: "X",
			Qty:           "1",
			UnitID:        seedUnitID,
			SellingPrice:  "1000",
		}},
	}
	_, err := repo.Update(ctx, 9999999, upd, seedUserID, &zero)
	require.ErrorIs(t, err, quotations.ErrNotFound)
}

func TestRepo_ChangeStatus_StateMachine(t *testing.T) {
	t.Run("draft -> sent allowed", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id, err := repo.Create(ctx, sampleCreate(), seedUserID)
		require.NoError(t, err)
		require.NoError(t, repo.ChangeStatus(ctx, id, "sent", nil, seedUserID))
	})

	t.Run("draft -> accepted rejected", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id, err := repo.Create(ctx, sampleCreate(), seedUserID)
		require.NoError(t, err)
		err = repo.ChangeStatus(ctx, id, "accepted", nil, seedUserID)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "Invalid status transition")
	})

	t.Run("sent -> accepted allowed", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id, err := repo.Create(ctx, sampleCreate(), seedUserID)
		require.NoError(t, err)
		require.NoError(t, repo.ChangeStatus(ctx, id, "sent", nil, seedUserID))
		require.NoError(t, repo.ChangeStatus(ctx, id, "accepted", nil, seedUserID))
	})

	t.Run("sent -> revision -> sent", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id, err := repo.Create(ctx, sampleCreate(), seedUserID)
		require.NoError(t, err)
		require.NoError(t, repo.ChangeStatus(ctx, id, "sent", nil, seedUserID))
		require.NoError(t, repo.ChangeStatus(ctx, id, "revision", nil, seedUserID))
		require.NoError(t, repo.ChangeStatus(ctx, id, "sent", nil, seedUserID))
	})

	t.Run("accepted terminal", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id, err := repo.Create(ctx, sampleCreate(), seedUserID)
		require.NoError(t, err)
		require.NoError(t, repo.ChangeStatus(ctx, id, "sent", nil, seedUserID))
		require.NoError(t, repo.ChangeStatus(ctx, id, "accepted", nil, seedUserID))
		err = repo.ChangeStatus(ctx, id, "sent", nil, seedUserID)
		require.Error(t, err)
	})

	t.Run("idempotent same status", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id, err := repo.Create(ctx, sampleCreate(), seedUserID)
		require.NoError(t, err)
		require.NoError(t, repo.ChangeStatus(ctx, id, "draft", nil, seedUserID))
	})

	t.Run("missing id raises", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		err := repo.ChangeStatus(ctx, 999999, "sent", nil, seedUserID)
		require.Error(t, err)
	})
}

func TestRepo_ChangeStatus_AllValidTransitions(t *testing.T) {
	cases := []struct {
		path []string
	}{
		{[]string{"draft", "sent", "accepted"}},
		{[]string{"draft", "sent", "rejected"}},
		{[]string{"draft", "sent", "expired"}},
		{[]string{"draft", "sent", "revision", "sent"}},
		{[]string{"draft", "sent", "revision", "rejected"}},
		{[]string{"draft", "expired"}},
	}
	for _, tc := range cases {
		t.Run(strings.Join(tc.path, "_"), func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			id, err := repo.Create(ctx, sampleCreate(), seedUserID)
			require.NoError(t, err)
			for _, s := range tc.path[1:] {
				require.NoErrorf(t, repo.ChangeStatus(ctx, id, s, nil, seedUserID), "step to %s", s)
			}
		})
	}
}

func TestRepo_ChangeStatus_RejectsInvalid(t *testing.T) {
	cases := []struct {
		from, to string
	}{
		{"draft", "accepted"},
		{"draft", "rejected"},
		{"draft", "revision"},
		{"sent", "draft"},
		{"revision", "accepted"},
		{"revision", "draft"},
		{"revision", "expired"},
	}
	for _, tc := range cases {
		t.Run(tc.from+"_to_"+tc.to, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			id, err := repo.Create(ctx, sampleCreate(), seedUserID)
			require.NoError(t, err)
			if tc.from == "sent" || tc.from == "revision" {
				require.NoError(t, repo.ChangeStatus(ctx, id, "sent", nil, seedUserID))
			}
			if tc.from == "revision" {
				require.NoError(t, repo.ChangeStatus(ctx, id, "revision", nil, seedUserID))
			}
			err = repo.ChangeStatus(ctx, id, tc.to, nil, seedUserID)
			require.Error(t, err)
		})
	}
}

func TestRepo_List_FiltersAndSort(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	for i := 0; i < 3; i++ {
		_, err := repo.Create(ctx, sampleCreate(), seedUserID)
		require.NoError(t, err)
	}

	res, err := repo.List(ctx, quotations.ListFilter{Limit: 10})
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(res.Rows), 3)
	assert.GreaterOrEqual(t, res.Total, int64(3))

	res2, err := repo.List(ctx, quotations.ListFilter{Statuses: []string{"draft"}, Limit: 10})
	require.NoError(t, err)
	for _, r := range res2.Rows {
		assert.Equal(t, "draft", r.Status)
	}

	resSearch, err := repo.List(ctx, quotations.ListFilter{Q: "IMC", Limit: 10})
	require.NoError(t, err)
	for _, r := range resSearch.Rows {
		assert.Contains(t, strings.ToUpper(r.CompanyName), "IMC")
	}

	resAsc, err := repo.List(ctx, quotations.ListFilter{SortBy: "quotation_no", SortDir: "asc", Limit: 100})
	require.NoError(t, err)
	for i := 1; i < len(resAsc.Rows); i++ {
		assert.LessOrEqual(t, resAsc.Rows[i-1].QuotationNo, resAsc.Rows[i].QuotationNo)
	}

	resTotalSort, err := repo.List(ctx, quotations.ListFilter{SortBy: "total", SortDir: "asc", Limit: 100})
	require.NoError(t, err)
	assert.NotEmpty(t, resTotalSort.Rows)

	resVerSort, err := repo.List(ctx, quotations.ListFilter{SortBy: "version", SortDir: "asc", Limit: 100})
	require.NoError(t, err)
	assert.NotEmpty(t, resVerSort.Rows)

	resBadSort, err := repo.List(ctx, quotations.ListFilter{SortBy: "; DROP TABLE--", Limit: 100})
	require.NoError(t, err)
	assert.NotEmpty(t, resBadSort.Rows)
}

func TestRepo_List_TotalAndDateBounds(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	_, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	min := "0"
	max := "999999999"
	from := "1900-01-01"
	to := "2099-12-31"
	res, err := repo.List(ctx, quotations.ListFilter{
		MinTotal: &min, MaxTotal: &max, DateFrom: &from, DateTo: &to, Limit: 10,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, res.Rows)

	zeroMax := "0"
	resHigh, err := repo.List(ctx, quotations.ListFilter{MaxTotal: &zeroMax, Limit: 10})
	require.NoError(t, err)
	assert.Empty(t, resHigh.Rows)
}

func TestRepo_List_PaginationBounds(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	_, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	res, err := repo.List(ctx, quotations.ListFilter{Limit: 0, Offset: 0})
	require.NoError(t, err)
	assert.NotNil(t, res.Rows)

	resHigh, err := repo.List(ctx, quotations.ListFilter{Limit: 999, Offset: 0})
	require.NoError(t, err)
	assert.NotNil(t, resHigh.Rows)
}

func TestRepo_Stats(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	_, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	stats, err := repo.Stats(ctx)
	require.NoError(t, err)
	var draftCount int64
	for _, s := range stats {
		if s.Status == "draft" {
			draftCount = s.Count
		}
	}
	assert.Greater(t, draftCount, int64(0))
}

func TestRepo_ListRevisions_SoloReturnsSelf(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	revs, err := repo.ListRevisions(ctx, id)
	require.NoError(t, err)
	require.Len(t, revs, 1)
	assert.Equal(t, id, revs[0].ID)
	assert.Equal(t, int16(1), revs[0].Version)
	assert.Nil(t, revs[0].ParentID)
}

func TestRepo_ListRevisions_WalksChain(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	root, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	var childID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, version, parent_id,
			company_client_id, company_client_name, status,
			discount_pct, total_produk, total, total_discount,
			created_by, updated_by)
		SELECT quotation_no || '-r2', 2, $1,
			company_client_id, company_client_name, 'draft',
			discount_pct, total_produk, total, total_discount,
			created_by, updated_by
		FROM quotations WHERE id = $1
		RETURNING id`, root).Scan(&childID))

	// Query from child should return both, ordered by version.
	revs, err := repo.ListRevisions(ctx, childID)
	require.NoError(t, err)
	require.Len(t, revs, 2)
	assert.Equal(t, root, revs[0].ID)
	assert.Equal(t, int16(1), revs[0].Version)
	assert.Equal(t, childID, revs[1].ID)
	assert.Equal(t, int16(2), revs[1].Version)
	require.NotNil(t, revs[1].ParentID)
	assert.Equal(t, root, *revs[1].ParentID)
}

func TestRepo_ListRevisions_NotFound(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	revs, err := repo.ListRevisions(ctx, 9_999_999)
	require.NoError(t, err)
	assert.Empty(t, revs)
}

func TestRepo_UpdateContact_HappyPath(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	// Sibling contact, same company.
	var altContactID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, country_code, created_by, updated_by)
		VALUES ($1, 'Alt Contact', 'IDN', $2, $2)
		RETURNING id`, seedCompanyID, seedUserID).Scan(&altContactID))
	require.NoError(t, repo.UpdateContact(ctx, id, altContactID, seedUserID))

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	require.NotNil(t, d.ContactID)
	assert.Equal(t, altContactID, *d.ContactID)
	assert.NotNil(t, d.ContactName)
}

func TestRepo_UpdateContact_WrongCompany(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	// Insert a contact for company 2 inside the tx.
	var wrongContactID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO company_contacts (company_id, name, country_code, created_by, updated_by)
		VALUES (2, 'Wrong Contact', 'IDN', $1, $1)
		RETURNING id`, seedUserID).Scan(&wrongContactID))

	err = repo.UpdateContact(ctx, id, wrongContactID, seedUserID)
	assert.ErrorIs(t, err, quotations.ErrContactNotAllowed)
}

func TestRepo_UpdateContact_NotFound(t *testing.T) {
	ctx, repo, _ := newRepo(t)
	err := repo.UpdateContact(ctx, 9_999_999, seedContactID, seedUserID)
	assert.ErrorIs(t, err, quotations.ErrNotFound)
}

func int64Ptr(v int64) *int64 { return &v }
