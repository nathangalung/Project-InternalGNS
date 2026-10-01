package app

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/live"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// committedDraft stores a bare draft.
// The stream only checks that the quotation exists.
func committedDraft(t *testing.T) int64 {
	t.Helper()
	ctx := context.Background()
	pool := testutil.Pool(t)
	cleaner := testutil.NewCleaner(t)
	name := "PT Stream " + strconv.FormatInt(time.Now().UnixNano(), 10)
	var clientID int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO company_client (number, name, country_code, created_by, updated_by)
		VALUES (fn_next_client_number(), $1, 'IDN', 1, 1) RETURNING id`, name).Scan(&clientID))
	cleaner.Client(clientID)
	var id int64
	require.NoError(t, pool.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        status, created_by, updated_by)
		VALUES ($1, $2, $3, 0, 0, 0, 0, 'draft', 1, 1) RETURNING id`,
		"SQ-STREAM-"+name, clientID, name).Scan(&id))
	cleaner.Quotation(id)
	return id
}

// Stream outlives the server timeouts.
// The production server reads and writes with deadlines far shorter than a
// stream's lifetime; the stream must still flush its first frame through
// every middleware and keep the connection past both deadlines.
func TestRouter_EventStreamOutlivesServerTimeouts(t *testing.T) {
	const timeout = 500 * time.Millisecond
	hub := live.NewHub()
	t.Cleanup(hub.Close)
	pool := testutil.Pool(t)
	cfg := Config{
		Env:                "test",
		JWTSecret:          "router-test-secret",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"http://localhost:5173"},
	}
	srv := httptest.NewUnstartedServer(NewRouter(cfg, pool, testutil.Store(t), nil, WithLive(hub)))
	srv.Config.ReadTimeout = timeout
	srv.Config.WriteTimeout = timeout
	srv.Start()
	t.Cleanup(srv.Close)

	id := committedDraft(t)
	userIDs := rbacUsers(t)
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/quotations/"+strconv.FormatInt(id, 10)+"/events", nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+mintToken(t, userIDs[string(users.RoleOperational)], "operational"))
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = res.Body.Close() })
	require.Equal(t, http.StatusOK, res.StatusCode)

	// Lines arrive on a channel, closed when the stream ends.
	lines := make(chan string, 16)
	go func() {
		defer close(lines)
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
	}()
	waitFor := func(prefix string) {
		t.Helper()
		deadline := time.After(2 * time.Second)
		for {
			select {
			case line, open := <-lines:
				require.True(t, open, "the stream ended before %q", prefix)
				if strings.HasPrefix(line, prefix) {
					return
				}
			case <-deadline:
				t.Fatalf("no %q within 2s", prefix)
			}
		}
	}
	waitFor("event: ready")
	waitFor("data: {}")

	// Past both deadlines the stream is still open.
	time.Sleep(3 * timeout)
	select {
	case line, open := <-lines:
		require.True(t, open, "the stream ended at the server deadline")
		assert.Empty(t, line)
	default:
	}

	// A change still arrives on the open stream.
	hub.Publish(live.Event{QuotationID: id, Kind: "lines", UserID: 1})
	waitFor("event: lines")
}
