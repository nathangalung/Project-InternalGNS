package clients_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const numberInvalidMsg = "Nomor klien harus 4 digit dan belum dipakai."

var fourDigits = regexp.MustCompile(`^[0-9]{4}$`)

// takenNumber commits a client, returns its number.
func takenNumber(t *testing.T, cleaner *testutil.Cleaner) string {
	t.Helper()
	pool := testutil.Pool(t)
	number := *freeNumber(t, pool)
	var id int64
	require.NoError(t, pool.QueryRow(context.Background(), `
		INSERT INTO company_client (number, name, country_code, created_by, updated_by)
		VALUES ($1, $2, 'IDN', $3, $3) RETURNING id`,
		number, fmt.Sprintf("PT Taken %d", time.Now().UnixNano()), seedUserID).Scan(&id))
	cleaner.Client(id)
	return number
}

// Server assigns or validates the number.
func TestHandler_Create_ClientNumber(t *testing.T) {
	cleaner := testutil.NewCleaner(t)
	srv := newSrv(t)
	taken := takenNumber(t, cleaner)
	free := *freeNumber(t, testutil.Pool(t))

	tests := []struct {
		name       string
		number     any // omitted when nil
		wantStatus int
		wantNumber string // empty means any four digits
	}{
		{"omitted is assigned", nil, http.StatusCreated, ""},
		{"empty is assigned", "", http.StatusCreated, ""},
		{"whitespace is assigned", "   ", http.StatusCreated, ""},
		{"free number is kept", free, http.StatusCreated, free},
		{"free text rejected", "REF-ABC", http.StatusUnprocessableEntity, ""},
		{"too short rejected", "12", http.StatusUnprocessableEntity, ""},
		{"too long rejected", "12345", http.StatusUnprocessableEntity, ""},
		{"taken number rejected", taken, http.StatusUnprocessableEntity, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := map[string]any{"name": fmt.Sprintf("PT Nomor %d", time.Now().UnixNano())}
			if tt.number != nil {
				body["number"] = tt.number
			}
			res := doJSON(t, srv, http.MethodPost, "/clients/", body)
			defer res.Body.Close()
			require.Equal(t, tt.wantStatus, res.StatusCode)

			if tt.wantStatus != http.StatusCreated {
				var problem httperr.Error
				require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
				assert.Equal(t, numberInvalidMsg, problem.Fields["number"])
				assert.Equal(t, numberInvalidMsg, problem.Detail)
				return
			}
			var c clients.Client
			require.NoError(t, json.NewDecoder(res.Body).Decode(&c))
			cleaner.Client(c.ID)
			require.NotNil(t, c.Number)
			assert.Regexp(t, fourDigits, *c.Number)
			if tt.wantNumber != "" {
				assert.Equal(t, tt.wantNumber, *c.Number)
			}
		})
	}
}

// Two concurrent creates get distinct numbers.
func TestRepo_Create_ConcurrentAssignsDistinctNumbers(t *testing.T) {
	cleaner := testutil.NewCleaner(t)
	pool := testutil.Pool(t)
	repo := clients.NewRepo(pool, testutil.Store(t))

	const workers = 2
	start := make(chan struct{})
	var wg sync.WaitGroup
	got := make([]clients.Client, workers)
	errs := make([]error, workers)
	for i := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			got[i], errs[i] = repo.Create(context.Background(), clients.CreateClientRequest{
				Name: fmt.Sprintf("PT Concurrent %d %d", i, time.Now().UnixNano()),
			}, seedUserID)
		}()
	}
	close(start)
	wg.Wait()

	for i := range workers {
		require.NoError(t, errs[i])
		cleaner.Client(got[i].ID)
		require.NotNil(t, got[i].Number)
		assert.Regexp(t, fourDigits, *got[i].Number)
	}
	assert.NotEqual(t, *got[0].Number, *got[1].Number)
}

// insertQuotation references the client.
func insertQuotation(t *testing.T, ctx context.Context, tx pgx.Tx, clientID int64) {
	t.Helper()
	_, err := tx.Exec(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        created_by, updated_by)
		VALUES ($1, $2, 'PT Fixture', 0, 0, 0, 0, 1, 1)`,
		"Q-NUM-"+strconv.FormatInt(time.Now().UnixNano(), 10), clientID)
	require.NoError(t, err)
}

// Number edits follow quotation usage.
func TestRepo_Update_ClientNumber(t *testing.T) {
	tests := []struct {
		name      string
		quoted    bool
		newNumber func(t *testing.T, tx pgx.Tx, own string) *string
		wantErr   error
		wantOwn   bool // number unchanged
	}{
		{"omitted keeps number", true,
			func(*testing.T, pgx.Tx, string) *string { return nil }, nil, true},
		{"same number while quoted", true,
			func(_ *testing.T, _ pgx.Tx, own string) *string { return &own }, nil, true},
		{"change before any quotation", false,
			func(t *testing.T, tx pgx.Tx, _ string) *string { return freeNumber(t, tx) }, nil, false},
		{"change after quotation", true,
			func(t *testing.T, tx pgx.Tx, _ string) *string { return freeNumber(t, tx) }, clients.ErrNumberLocked, true},
		{"change to taken number", false,
			func(t *testing.T, tx pgx.Tx, _ string) *string {
				other := freeNumber(t, tx)
				_, err := tx.Exec(context.Background(), `
					INSERT INTO company_client (number, name, country_code, created_by, updated_by)
					VALUES ($1, 'PT Other', 'IDN', 1, 1)`, *other)
				require.NoError(t, err)
				return other
			}, clients.ErrNumberInvalid, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			repo := clients.NewRepo(tx, testutil.Store(t))

			c, err := repo.Create(ctx, clients.CreateClientRequest{Name: "PT Ubah Nomor"}, seedUserID)
			require.NoError(t, err)
			own := *c.Number
			if tt.quoted {
				insertQuotation(t, ctx, tx, c.ID)
			}
			want := tt.newNumber(t, tx, own)

			got, err := repo.Update(ctx, c.ID, clients.UpdateClientRequest{
				Number: want, Name: c.Name, CountryCode: "IDN", IsActive: true,
			}, seedUserID)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				return
			}
			require.NoError(t, err)
			if tt.wantOwn {
				assert.Equal(t, own, *got.Number)
			} else {
				assert.Equal(t, *want, *got.Number)
			}
		})
	}
}

// A missing client stays 404.
func TestRepo_Update_MissingClientWithNumber(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := clients.NewRepo(tx, testutil.Store(t))
	_, err := repo.Update(ctx, 999999999, clients.UpdateClientRequest{
		Number: ptr("0001"), Name: "X", CountryCode: "IDN",
	}, seedUserID)
	assert.ErrorIs(t, err, clients.ErrNotFound)
}

// PUT validates the number format.
func TestHandler_Update_ClientNumberFormat(t *testing.T) {
	srv := newSrv(t)
	id := newClient(t)
	tests := []struct {
		name   string
		number string
	}{
		{"free text", "REF-ABC"},
		{"too short", "12"},
		{"too long", "12345"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPut, "/clients/"+strconv.FormatInt(id, 10),
				map[string]any{"name": "PT Format", "countryCode": "IDN", "isActive": true, "number": tt.number})
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			var problem httperr.Error
			require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
			assert.Equal(t, numberInvalidMsg, problem.Fields["number"])
		})
	}
}
