package clients_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const (
	seedUserID    int64 = 1
	seedCompanyID int64 = 1
)

func ptr[T any](v T) *T { return &v }

func TestRepo_List(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	res, err := repo.List(ctx, clients.ListFilter{Limit: 50})
	require.NoError(t, err)
	assert.NotEmpty(t, res.Rows)
	assert.Greater(t, res.Total, int64(0))
}

func TestRepo_List_FilterByQuery(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	res, err := repo.List(ctx, clients.ListFilter{Q: "IMC", Limit: 50})
	require.NoError(t, err)
	require.NotEmpty(t, res.Rows)
	for _, c := range res.Rows {
		assert.Contains(t, strings.ToUpper(c.Name+derefStr(c.Number)+derefStr(c.NPWP)+derefStr(c.ContactName)), "IMC")
	}
}

func TestRepo_List_FilterByActive(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	active := true
	res, err := repo.List(ctx, clients.ListFilter{IsActive: &active, Limit: 200})
	require.NoError(t, err)
	for _, c := range res.Rows {
		assert.True(t, c.IsActive)
	}
}

func TestRepo_List_TotalCountReflectsFilter(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	all, err := repo.List(ctx, clients.ListFilter{Limit: 1})
	require.NoError(t, err)
	filtered, err := repo.List(ctx, clients.ListFilter{Q: "IMC", Limit: 1})
	require.NoError(t, err)
	assert.LessOrEqual(t, filtered.Total, all.Total)
}

func TestRepo_List_SortByCreatedAtDesc(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	res, err := repo.List(ctx, clients.ListFilter{SortBy: "createdAt", SortDir: "desc", Limit: 10})
	require.NoError(t, err)
	require.NotEmpty(t, res.Rows)
	for i := 1; i < len(res.Rows); i++ {
		assert.False(t, res.Rows[i].CreatedAt.After(res.Rows[i-1].CreatedAt))
	}
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func TestRepo_GetByID(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	c, err := repo.GetByID(ctx, seedCompanyID)
	require.NoError(t, err)
	assert.Equal(t, seedCompanyID, c.ID)
	assert.NotEmpty(t, c.Name)
}

func TestRepo_GetByID_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	_, err := repo.GetByID(ctx, 99999999)
	assert.ErrorIs(t, err, clients.ErrNotFound)
}

func TestRepo_Create(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	req := clients.CreateClientRequest{
		Number:      ptr("9999"),
		Name:        "PT Test Anyar",
		NPWP:        ptr("0999999999999000"),
		Address:     ptr("Jakarta Pusat"),
		Email:       ptr("test@anyar.local"),
		CountryCode: "IDN",
		TkuID:       ptr("0999999999999000000000"),
	}
	c, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	assert.Greater(t, c.ID, int64(0))
	assert.Equal(t, "PT Test Anyar", c.Name)
	assert.Equal(t, "IDN", c.CountryCode)
}

func TestRepo_Create_DefaultsCountryCode(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	req := clients.CreateClientRequest{
		Number:      ptr("9998"),
		Name:        "PT Default Country",
		CountryCode: "",
	}
	c, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, "IDN", c.CountryCode)
}

func TestRepo_Search(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	results, err := repo.Search(ctx, "IMC", 0.1, 5)
	require.NoError(t, err)
	assert.NotEmpty(t, results)
	assert.Equal(t, "PT. IMC Ship Management", results[0].CompanyName)
}

func TestRepo_ListContacts(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	rows, err := repo.ListContacts(ctx, seedCompanyID)
	require.NoError(t, err)
	assert.NotEmpty(t, rows)
}

func TestRepo_DeactivateContact(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	c, err := repo.CreateContact(ctx, seedCompanyID,
		clients.CreateContactRequest{Name: "To Remove", CountryCode: "IDN"}, seedUserID)
	require.NoError(t, err)

	require.NoError(t, repo.DeactivateContact(ctx, seedCompanyID, c.ID, seedUserID))

	// Gone from the active list.
	rows, err := repo.ListContacts(ctx, seedCompanyID)
	require.NoError(t, err)
	for _, row := range rows {
		assert.NotEqual(t, c.ID, row.ID)
	}

	// Second removal reports not found.
	err = repo.DeactivateContact(ctx, seedCompanyID, c.ID, seedUserID)
	assert.ErrorIs(t, err, clients.ErrNotFound)
}

func TestRepo_DeactivateContact_WrongCompany(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	c, err := repo.CreateContact(ctx, seedCompanyID,
		clients.CreateContactRequest{Name: "Other Company", CountryCode: "IDN"}, seedUserID)
	require.NoError(t, err)

	// Wrong company cannot remove it.
	err = repo.DeactivateContact(ctx, seedCompanyID+999999, c.ID, seedUserID)
	assert.ErrorIs(t, err, clients.ErrNotFound)
}

func TestRepo_CreateContact(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	req := clients.CreateContactRequest{
		Name:        "Test Contact",
		Email:       ptr("contact@test.local"),
		Phone:       ptr("081234567890"),
		Title:       ptr("Manager"),
		CountryCode: "IDN",
	}
	c, err := repo.CreateContact(ctx, seedCompanyID, req, seedUserID)
	require.NoError(t, err)
	assert.Greater(t, c.ID, int64(0))
	assert.Equal(t, "Test Contact", c.Name)
}

func TestRepo_CreateContact_DefaultsCountryCode(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	req := clients.CreateContactRequest{
		Name:        "Default Country Contact",
		CountryCode: "",
	}
	c, err := repo.CreateContact(ctx, seedCompanyID, req, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, "IDN", c.CountryCode)
}

func TestRepo_CreateContact_PhoneCheckRejectsShort(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	req := clients.CreateContactRequest{
		Name:        "Short Phone",
		Phone:       ptr("12345"),
		CountryCode: "IDN",
	}
	_, err := repo.CreateContact(ctx, seedCompanyID, req, seedUserID)
	require.Error(t, err)
}

func TestRepo_CreateContact_PhoneCheckRejectsLong(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	req := clients.CreateContactRequest{
		Name:        "Long Phone",
		Phone:       ptr("12345678901234567890"),
		CountryCode: "IDN",
	}
	_, err := repo.CreateContact(ctx, seedCompanyID, req, seedUserID)
	require.Error(t, err)
}

func TestRepo_Summary(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))

	s, err := repo.Summary(ctx)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, s.Total, int64(1))
	assert.LessOrEqual(t, s.ActiveCount, s.Total)
	assert.GreaterOrEqual(t, s.NewThisMonth, int64(0))
	assert.GreaterOrEqual(t, s.NewThisYear, int64(0))
	assert.GreaterOrEqual(t, s.PrevYearTotal, int64(0))
}
