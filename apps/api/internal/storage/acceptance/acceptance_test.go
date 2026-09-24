package acceptance_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/golang-jwt/jwt/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/storage"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const jwtSecret = "storage-acceptance-signing-secret"

// Suite-wide router, store and accounts.
type suite struct {
	t       *testing.T
	cleaner *testutil.Cleaner
	store   *storage.Client
	srv     *httptest.Server
	run     int64
	seq     atomic.Int64

	mu    sync.Mutex
	users map[string]int64
	keys  []storedKey
}

type storedKey struct{ bucket, key string }

// minioConfig reads the store the suite runs against.
func minioConfig(t *testing.T) storage.Config {
	t.Helper()
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		t.Skip("MINIO_ENDPOINT not set; skipping the storage acceptance suite")
	}
	access, secret := os.Getenv("MINIO_ACCESS_KEY"), os.Getenv("MINIO_SECRET_KEY")
	if access == "" || secret == "" {
		// Local dev defaults from compose.dev.yml.
		access, secret = "minioadmin", "minioadmin"
	}
	return storage.Config{
		Endpoint:  endpoint,
		AccessKey: access,
		SecretKey: secret,
		UseSSL:    os.Getenv("MINIO_USE_SSL") == "true",
	}
}

func newSuite(t *testing.T) *suite {
	cfg := minioConfig(t)
	pool := testutil.Pool(t)
	cleaner := testutil.NewCleaner(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	store, err := storage.New(ctx, cfg)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	s := &suite{t: t, cleaner: cleaner, store: store, run: time.Now().UnixNano(), users: map[string]int64{}}
	// Remove every object the suite stored, and only those.
	t.Cleanup(func() {
		for _, k := range s.keys {
			if err := store.RemoveObject(context.Background(), k.bucket, k.key); err != nil {
				t.Logf("remove %s/%s: %v", k.bucket, k.key, err)
			}
		}
	})
	router := app.NewRouter(app.Config{
		JWTSecret:          jwtSecret,
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"*"},
	}, pool, testutil.Store(t), store)
	s.srv = httptest.NewServer(router)
	t.Cleanup(s.srv.Close)
	return s
}

// track queues a key for removal.
func (s *suite) track(bucket, key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keys = append(s.keys, storedKey{bucket, key})
}

// userFor returns one account per role.
func (s *suite) userFor(role string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id, ok := s.users[role]; ok {
		return id, nil
	}
	u, err := users.NewRepo(testutil.Pool(s.t), testutil.Store(s.t)).Create(context.Background(), users.CreateUserRequest{
		Email:    fmt.Sprintf("atdd-storage-%s-%d@test.local", role, s.run),
		Name:     "ATDD Storage " + role,
		Password: "Storage-accept-pw1!",
		Role:     users.Role(role),
	}, 1)
	if err != nil {
		return 0, fmt.Errorf("create %s user: %w", role, err)
	}
	s.cleaner.User(u.ID)
	s.users[role] = u.ID
	return u.ID, nil
}

// bearer mints an access token the router accepts.
func bearer(userID int64, role string) (string, error) {
	now := time.Now()
	claims := auth.Claims{
		Role: users.Role(role),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(jwtSecret))
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return "Bearer " + signed, nil
}

// Per-scenario state.
type scenario struct {
	*suite
	token string

	last *http.Response
	body []byte

	bucket  string
	key     string
	payload []byte

	clientID    int64
	uploadURL   string
	objectKey   string
	downloadURL string
}

func (sc *scenario) do(method, path string, body io.Reader, contentType string) error {
	req, err := http.NewRequest(method, sc.srv.URL+path, body)
	if err != nil {
		return err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if sc.token != "" {
		req.Header.Set("Authorization", sc.token)
	}
	res, err := sc.srv.Client().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	sc.last, sc.body = res, raw
	return nil
}

func (sc *scenario) doJSON(method, path string, body any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return sc.do(method, path, bytes.NewReader(raw), "application/json")
}

func objectPath(bucket, key string) string {
	v := url.Values{}
	v.Set("bucket", bucket)
	v.Set("key", key)
	return "/api/v1/storage/object?" + v.Encode()
}

// payloadOf builds distinct bytes per upload.
func (sc *scenario) payloadOf(size int) []byte {
	n := sc.seq.Add(1)
	stamp := []byte(fmt.Sprintf("atdd-%d-%d|", sc.run, n))
	out := bytes.Repeat([]byte{'z'}, size)
	copy(out, stamp)
	return out
}

func (sc *scenario) signedInAs(role string) error {
	id, err := sc.userFor(role)
	if err != nil {
		return err
	}
	sc.token, err = bearer(id, role)
	return err
}

func (sc *scenario) notSignedIn() error {
	sc.token = ""
	return nil
}

func (sc *scenario) put(bucket, key string, payload []byte, contentType string) error {
	sc.bucket, sc.key = bucket, key
	sc.track(bucket, key)
	if err := sc.do(http.MethodPut, objectPath(bucket, key), bytes.NewReader(payload), contentType); err != nil {
		return err
	}
	if sc.last.StatusCode == http.StatusNoContent {
		sc.payload = payload
	}
	return nil
}

func (sc *scenario) freshKey(file string) string {
	return fmt.Sprintf("atdd-storage/%d/%d-%s", sc.run, sc.seq.Add(1), file)
}

func (sc *scenario) upload(file string, size int, bucket string) error {
	return sc.put(bucket, sc.freshKey(file), sc.payloadOf(size), "application/octet-stream")
}

func (sc *scenario) uploadClaiming(file string, size int, bucket, contentType string) error {
	return sc.put(bucket, sc.freshKey(file), sc.payloadOf(size), contentType)
}

func (sc *scenario) uploaded(file string, size int, bucket string) error {
	if err := sc.upload(file, size, bucket); err != nil {
		return err
	}
	return sc.statusIs(http.StatusNoContent)
}

func (sc *scenario) uploadAgain() error {
	kept := sc.payload
	if err := sc.put(sc.bucket, sc.key, sc.payloadOf(48), "application/octet-stream"); err != nil {
		return err
	}
	if sc.last.StatusCode != http.StatusNoContent {
		sc.payload = kept
	}
	return nil
}

func (sc *scenario) uploadAt(bucket, key string) error {
	return sc.put(bucket, key, sc.payloadOf(16), "application/octet-stream")
}

func (sc *scenario) download() error {
	return sc.do(http.MethodGet, objectPath(sc.bucket, sc.key), nil, "")
}

func (sc *scenario) downloadMissing(bucket string) error {
	sc.bucket, sc.key = bucket, sc.freshKey("never.pdf")
	return sc.download()
}

func (sc *scenario) statusIs(want int) error {
	if sc.last == nil {
		return fmt.Errorf("no response yet")
	}
	if sc.last.StatusCode != want {
		return fmt.Errorf("status = %d, want %d; body=%s", sc.last.StatusCode, want, sc.body)
	}
	return nil
}

func (sc *scenario) isProblem() error {
	if ct := sc.last.Header.Get("Content-Type"); ct != "application/problem+json" {
		return fmt.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
	var p struct {
		Status int    `json:"status"`
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(sc.body, &p); err != nil {
		return fmt.Errorf("decode problem: %w body=%s", err, sc.body)
	}
	if p.Status != sc.last.StatusCode || p.Detail == "" {
		return fmt.Errorf("problem %+v does not match status %d or has no detail", p, sc.last.StatusCode)
	}
	return nil
}

func (sc *scenario) detailIs(want string) error {
	if err := sc.isProblem(); err != nil {
		return err
	}
	var p struct {
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(sc.body, &p); err != nil {
		return err
	}
	if p.Detail != want {
		return fmt.Errorf("detail = %q, want %q", p.Detail, want)
	}
	return nil
}

func (sc *scenario) carriesBytes() error {
	if sc.payload == nil {
		return fmt.Errorf("nothing was uploaded in this scenario")
	}
	if !bytes.Equal(sc.body, sc.payload) {
		return fmt.Errorf("download has %d bytes, want the %d uploaded", len(sc.body), len(sc.payload))
	}
	return nil
}

func (sc *scenario) attachmentOfType(want string) error {
	if got := sc.last.Header.Get("Content-Type"); got != want {
		return fmt.Errorf("Content-Type = %q, want %q", got, want)
	}
	name := sc.key[strings.LastIndex(sc.key, "/")+1:]
	wantDisposition := fmt.Sprintf("attachment; filename=%q", name)
	if got := sc.last.Header.Get("Content-Disposition"); got != wantDisposition {
		return fmt.Errorf("Content-Disposition = %q, want %q", got, wantDisposition)
	}
	return nil
}

func (sc *scenario) forbidsSniffing() error {
	h := sc.last.Header
	if h.Get("X-Content-Type-Options") != "nosniff" || h.Get("X-Frame-Options") != "DENY" {
		return fmt.Errorf("security headers missing: %v", h)
	}
	if !strings.Contains(h.Get("Content-Security-Policy"), "default-src 'none'") {
		return fmt.Errorf("CSP = %q", h.Get("Content-Security-Policy"))
	}
	return nil
}

func (sc *scenario) nothingStored() error {
	exists, err := sc.store.ObjectExists(context.Background(), sc.bucket, sc.key)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("%s/%s exists after a refused upload", sc.bucket, sc.key)
	}
	return nil
}

func (sc *scenario) clientCreated() error {
	if err := sc.doJSON(http.MethodPost, "/api/v1/clients/",
		map[string]string{"name": fmt.Sprintf("ATDD Storage %d-%d", sc.run, sc.seq.Add(1))}); err != nil {
		return err
	}
	if err := sc.statusIs(http.StatusCreated); err != nil {
		return err
	}
	var c struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(sc.body, &c); err != nil {
		return err
	}
	sc.cleaner.Client(c.ID)
	sc.clientID = c.ID
	return nil
}

func (sc *scenario) askUploadURL(file string) error {
	path := fmt.Sprintf("/api/v1/clients/%d/logo/upload-url?fileName=%s", sc.clientID, url.QueryEscape(file))
	if err := sc.do(http.MethodGet, path, nil, ""); err != nil {
		return err
	}
	if sc.last.StatusCode != http.StatusOK {
		return nil
	}
	var r struct {
		UploadURL string `json:"uploadUrl"`
		ObjectKey string `json:"objectKey"`
	}
	if err := json.Unmarshal(sc.body, &r); err != nil {
		return err
	}
	sc.uploadURL, sc.objectKey = r.UploadURL, r.ObjectKey
	sc.bucket, sc.key = storage.BucketClientLogos, r.ObjectKey
	sc.track(storage.BucketClientLogos, r.ObjectKey)
	return nil
}

func (sc *scenario) uploadURLInFolder() error {
	folder := fmt.Sprintf("clients/%d/", sc.clientID)
	if !strings.HasPrefix(sc.objectKey, folder) {
		return fmt.Errorf("object key %q is outside %q", sc.objectKey, folder)
	}
	if sc.uploadURL != "/storage/object?bucket="+storage.BucketClientLogos+"&key="+url.QueryEscape(sc.objectKey) {
		return fmt.Errorf("upload URL %q is not the proxy path for %q", sc.uploadURL, sc.objectKey)
	}
	return nil
}

func (sc *scenario) uploadToURL(size int) error {
	payload := sc.payloadOf(size)
	if err := sc.do(http.MethodPut, "/api/v1"+sc.uploadURL, bytes.NewReader(payload), "image/png"); err != nil {
		return err
	}
	if sc.last.StatusCode == http.StatusNoContent {
		sc.payload = payload
	}
	return nil
}

func (sc *scenario) attachUploaded() error {
	return sc.doJSON(http.MethodPatch, fmt.Sprintf("/api/v1/clients/%d/logo", sc.clientID),
		map[string]string{"objectKey": sc.objectKey})
}

func (sc *scenario) attachForeign() error {
	foreign := storage.BuildObjectKey("clients", sc.clientID+1_000_000, "logo.png")
	return sc.doJSON(http.MethodPatch, fmt.Sprintf("/api/v1/clients/%d/logo", sc.clientID),
		map[string]string{"objectKey": foreign})
}

func (sc *scenario) askDownloadURL() error {
	if err := sc.do(http.MethodGet, fmt.Sprintf("/api/v1/clients/%d/logo/download-url", sc.clientID), nil, ""); err != nil {
		return err
	}
	if sc.last.StatusCode != http.StatusOK {
		return nil
	}
	var r struct {
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.Unmarshal(sc.body, &r); err != nil {
		return err
	}
	sc.downloadURL = r.DownloadURL
	return nil
}

func (sc *scenario) downloadFromURL() error {
	if sc.downloadURL == "" {
		return fmt.Errorf("no download URL was issued")
	}
	return sc.do(http.MethodGet, "/api/v1"+sc.downloadURL, nil, "")
}

func initScenario(s *suite) func(*godog.ScenarioContext) {
	return func(ctx *godog.ScenarioContext) {
		sc := &scenario{suite: s}
		ctx.Before(func(c context.Context, _ *godog.Scenario) (context.Context, error) {
			*sc = scenario{suite: s}
			return c, nil
		})

		ctx.Step(`^I am signed in as "([^"]*)"$`, sc.signedInAs)
		ctx.Step(`^I am not signed in$`, sc.notSignedIn)
		ctx.Step(`^I upload "([^"]*)" of (\d+) bytes to "([^"]*)"$`, sc.upload)
		ctx.Step(`^I upload "([^"]*)" of (\d+) bytes to "([^"]*)" claiming type "([^"]*)"$`, sc.uploadClaiming)
		ctx.Step(`^I uploaded "([^"]*)" of (\d+) bytes to "([^"]*)"$`, sc.uploaded)
		ctx.Step(`^I upload different bytes to the same key$`, sc.uploadAgain)
		ctx.Step(`^I upload to bucket "([^"]*)" at key "([^"]*)"$`, sc.uploadAt)
		ctx.Step(`^I download that object$`, sc.download)
		ctx.Step(`^I download a key nobody uploaded from "([^"]*)"$`, sc.downloadMissing)
		ctx.Step(`^the response status is (\d+)$`, sc.statusIs)
		ctx.Step(`^the response is problem\+json$`, sc.isProblem)
		ctx.Step(`^the problem detail is "([^"]*)"$`, sc.detailIs)
		ctx.Step(`^the download carries the uploaded bytes$`, sc.carriesBytes)
		ctx.Step(`^the download is an attachment of type "([^"]*)"$`, sc.attachmentOfType)
		ctx.Step(`^the download forbids sniffing and framing$`, sc.forbidsSniffing)
		ctx.Step(`^nothing is stored under that key$`, sc.nothingStored)
		ctx.Step(`^a client I created$`, sc.clientCreated)
		ctx.Step(`^I ask for a logo upload URL for "([^"]*)"$`, sc.askUploadURL)
		ctx.Step(`^the upload URL points at the proxy inside the client's folder$`, sc.uploadURLInFolder)
		ctx.Step(`^I upload (\d+) bytes to that upload URL$`, sc.uploadToURL)
		ctx.Step(`^I attach the uploaded logo to the client$`, sc.attachUploaded)
		ctx.Step(`^I attach a logo key from another client's folder$`, sc.attachForeign)
		ctx.Step(`^I ask for the logo download URL$`, sc.askDownloadURL)
		ctx.Step(`^I download from that URL$`, sc.downloadFromURL)
	}
}

func TestStorageFeatures(t *testing.T) {
	testutil.RequireDB(t)
	s := newSuite(t)
	suite := godog.TestSuite{
		ScenarioInitializer: initScenario(s),
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features"},
			TestingT: t,
			Strict:   true,
		},
	}
	if status := suite.Run(); status != 0 {
		t.Fatalf("godog suite failed status=%d", status)
	}
}
