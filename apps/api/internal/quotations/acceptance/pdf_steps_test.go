package acceptance_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"

	"github.com/cucumber/godog"
	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Catalog item seeded by SeedMasterIfMissing.
const offeredItemID int64 = 9000001

// pdfServer mounts real-template quotations.
func (s *scenarioState) pdfServer() *httptest.Server {
	_, here, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(here), "..", "..", "..", "templates", "documents")
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(deps.WithUserID(req.Context(), s.userID)))
		})
	})
	r.Mount("/quotations", quotations.Routes(deps.Deps{
		Pool:          testutil.Pool(s.t),
		Queries:       testutil.Store(s.t),
		TemplatesRoot: root,
		Pdf:           deps.PdfSettings{SignerName: "Director"},
	}))
	srv := httptest.NewServer(r)
	s.t.Cleanup(srv.Close)
	return srv
}

func (s *scenarioState) createPricedQuotation() error {
	shipCost, shipAddr := "150.25", "Tanjung Priok"
	offered := offeredItemID
	req := s.buildCreate("10", 2)
	req.ShippingCost, req.ShippingAddress = &shipCost, &shipAddr
	req.Items[0].Qty, req.Items[0].SellingPrice = "2", "1000.50"
	req.Items[0].OfferedItemID = &offered
	req.Items[1].SellingPrice = "0"
	if err := s.sendRequest(http.MethodPost, "/quotations/", req); err != nil {
		return err
	}
	if s.last.StatusCode != http.StatusCreated {
		return fmt.Errorf("create want 201 got %d body=%s", s.last.StatusCode, s.body)
	}
	return s.responseHasID()
}

func (s *scenarioState) downloadPDF() error {
	for _, bin := range []string{"xelatex", "pdftotext", "pdfinfo"} {
		if _, err := exec.LookPath(bin); err != nil {
			return godog.ErrSkip
		}
	}
	srv := s.pdfServer()
	res, err := srv.Client().Get(srv.URL + "/quotations/" + strconv.FormatInt(s.lastID, 10) + "/pdf")
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("pdf want 200 got %d", res.StatusCode)
	}
	s.pdfPath = filepath.Join(s.t.TempDir(), "q.pdf")
	f, err := os.Create(s.pdfPath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.ReadFrom(res.Body)
	return err
}

// printed mimics PDF figure text.
func printed(numeric string) string {
	return strings.Replace(pdfgen.FormatIDRCents(numeric), "Rp~", "Rp ", 1)
}

func (s *scenarioState) pdfPrintsStoredTotals() error {
	if err := s.readDetail(); err != nil {
		return err
	}
	var d quotations.QuotationDetail
	if err := json.Unmarshal(s.body, &d); err != nil {
		return err
	}
	out, err := exec.Command("pdftotext", "-layout", s.pdfPath, "-").Output()
	if err != nil {
		return fmt.Errorf("pdftotext: %w", err)
	}
	text := strings.Join(strings.Fields(string(out)), " ")
	wants := []string{
		"Total Produk " + printed(d.TotalProduk),
		"Pengiriman Rp 150,25",
		"Sub Total " + printed(d.Subtotal),
		"DPP Nilai Lain " + printed(d.DppNilaiLain),
		"PPN 12% " + printed(d.PpnAmount),
		"Grand Total " + printed(d.GrandTotal),
		"No Offer",
	}
	for _, w := range wants {
		if !strings.Contains(text, w) {
			return fmt.Errorf("PDF misses %q in: %s", w, text)
		}
	}
	var name string
	if err := testutil.Pool(s.t).QueryRow(context.Background(),
		"SELECT name FROM items WHERE id = $1", offeredItemID).Scan(&name); err != nil {
		return err
	}
	if !strings.Contains(text, strings.Join(strings.Fields(name), " ")) {
		return fmt.Errorf("PDF misses the offered item %q", name)
	}
	return nil
}

var pagesRe = regexp.MustCompile(`Pages:\s+(\d+)`)

func (s *scenarioState) pdfPages(want int) error {
	out, err := exec.Command("pdfinfo", s.pdfPath).Output()
	if err != nil {
		return fmt.Errorf("pdfinfo: %w", err)
	}
	m := pagesRe.FindSubmatch(out)
	if m == nil {
		return fmt.Errorf("no page count in pdfinfo output")
	}
	if got, _ := strconv.Atoi(string(m[1])); got != want {
		return fmt.Errorf("want %d page(s) got %d", want, got)
	}
	return nil
}
