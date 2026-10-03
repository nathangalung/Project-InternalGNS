package clients_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Update answers like a read.
// The response carries the client's main contact, as GET does.
func TestRepo_Update_KeepsMainContact(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))
	created, err := repo.Create(ctx, clients.CreateClientRequest{
		Name: fmt.Sprintf("PT Kontak Utama %d", time.Now().UnixNano()), CountryCode: "IDN",
	}, seedUserID)
	require.NoError(t, err)
	_, err = repo.CreateContact(ctx, created.ID, clients.CreateContactRequest{
		Name: "Budi", Email: ptr("budi@test.local"), Phone: ptr("081234567890"),
	}, seedUserID)
	require.NoError(t, err)

	updated, err := repo.Update(ctx, created.ID, clients.UpdateClientRequest{
		Name: created.Name + " Baru", CountryCode: "IDN", IsActive: true,
	}, seedUserID)
	require.NoError(t, err)
	got, err := repo.GetByID(ctx, created.ID)
	require.NoError(t, err)

	require.NotNil(t, updated.ContactID)
	assert.Equal(t, got.ContactID, updated.ContactID)
	assert.Equal(t, got.ContactName, updated.ContactName)
	assert.Equal(t, got.ContactEmail, updated.ContactEmail)
	assert.Equal(t, got.ContactPhone, updated.ContactPhone)
	assert.Equal(t, got, updated, "the whole response matches a read")
}
