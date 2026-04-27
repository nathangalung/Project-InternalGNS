package clients_test

import (
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

	rows, err := repo.List(ctx, 50, 0)
	require.NoError(t, err)
	assert.NotEmpty(t, rows)
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
