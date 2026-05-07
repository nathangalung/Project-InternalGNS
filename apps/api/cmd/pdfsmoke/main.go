// Smoke renders quotation/invoice/delivery-note PDFs for one record.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func main() {
	qid := flag.Int64("qid", 2, "quotation id to render")
	pid := flag.Int64("pid", 0, "PO id to render delivery note")
	iid := flag.Int64("iid", 0, "invoice id to render")
	out := flag.String("out", "/tmp/pdfsmoke", "output dir")
	flag.Parse()

	if err := os.MkdirAll(*out, 0o755); err != nil {
		die(err)
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable"
	}

	ctx := context.Background()
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		die(err)
	}
	defer pool.Close()

	store, err := queries.Load()
	if err != nil {
		die(err)
	}

	d := deps.Deps{
		Pool:          pool,
		Queries:       store,
		TemplatesRoot: "templates/documents",
		Pdf: deps.PdfSettings{
			SignerName:    "Bryan Hutagalung",
			BankName:      "BCA",
			BankAccountNo: "001-234-5678",
			BankAccountNm: "PT GLOBAL NIAGA SAKTI",
			PaymentTerms:  "Net 30 days",
		},
	}

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := deps.WithUserID(req.Context(), 1)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/quotations", quotations.Routes(d))
	r.Mount("/purchase-orders", purchaseorders.Routes(d))
	r.Mount("/invoices", invoices.Routes(d))

	srv := httptest.NewServer(r)
	defer srv.Close()

	client := &http.Client{Timeout: 60 * time.Second}

	if *qid > 0 {
		fetch(client, srv.URL+"/quotations/"+strconv.FormatInt(*qid, 10)+"/pdf",
			*out+"/quotation_"+strconv.FormatInt(*qid, 10)+".pdf")
	}
	if *pid > 0 {
		fetch(client, srv.URL+"/purchase-orders/"+strconv.FormatInt(*pid, 10)+"/delivery-note.pdf",
			*out+"/delivery_note_"+strconv.FormatInt(*pid, 10)+".pdf")
	}
	if *iid > 0 {
		fetch(client, srv.URL+"/invoices/"+strconv.FormatInt(*iid, 10)+"/pdf",
			*out+"/invoice_"+strconv.FormatInt(*iid, 10)+".pdf")
	}
}

func fetch(c *http.Client, url, path string) {
	resp, err := c.Get(url)
	if err != nil {
		die(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		buf := make([]byte, 4096)
		n, _ := resp.Body.Read(buf)
		fmt.Fprintf(os.Stderr, "%s -> %d: %s\n", url, resp.StatusCode, string(buf[:n]))
		os.Exit(1)
	}
	f, err := os.Create(path)
	if err != nil {
		die(err)
	}
	defer f.Close()
	if _, err := io.Copy(f, resp.Body); err != nil {
		die(err)
	}
	fmt.Printf("ok %s -> %s\n", url, path)
}

func die(err error) {
	fmt.Fprintln(os.Stderr, "fatal:", err)
	os.Exit(1)
}
