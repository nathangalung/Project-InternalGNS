package invoices

import (
	"strings"
	"testing"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
)

func TestBuildGoodService_DBToCoretaxOptRemap(t *testing.T) {
	t.Parallel()
	code := "ITM-1"
	dpp := "100000.00"
	unitCoretax := "UM.0021"
	t.Run("barang B maps to Opt A", func(t *testing.T) {
		t.Parallel()
		g := "B"
		gs := buildGoodService(InvoiceItem{
			ItemCode:        &code,
			ItemName:        "Marine valve",
			Qty:             "2",
			UnitPrice:       "50000",
			Dpp:             &dpp,
			GoodsOrService:  &g,
			UnitCoretaxCode: &unitCoretax,
		})
		if gs.Opt != "A" {
			t.Fatalf("want Opt A for DB=B, got %q", gs.Opt)
		}
		if gs.Unit != "UM.0021" {
			t.Fatalf("want unit UM.0021, got %q", gs.Unit)
		}
	})
	t.Run("jasa J maps to Opt B", func(t *testing.T) {
		t.Parallel()
		g := "J"
		gs := buildGoodService(InvoiceItem{
			ItemName:       "Shipping",
			Qty:            "1",
			UnitPrice:      "75000",
			GoodsOrService: &g,
		})
		if gs.Opt != "B" {
			t.Fatalf("want Opt B for DB=J, got %q", gs.Opt)
		}
		if gs.Unit != "UM.0033" {
			t.Fatalf("want fallback UM.0033, got %q", gs.Unit)
		}
	})
	t.Run("nil goods_or_service defaults to Opt A", func(t *testing.T) {
		t.Parallel()
		gs := buildGoodService(InvoiceItem{ItemName: "x", Qty: "1", UnitPrice: "1"})
		if gs.Opt != "A" {
			t.Fatalf("want default Opt A, got %q", gs.Opt)
		}
	})
}

func TestBuildBulk_BuyerIDTKUFallback(t *testing.T) {
	t.Parallel()
	npwp := "0123456789012345"
	addr := "Jl. Kelapa 1"
	email := "buyer@example.com"
	h := &CoretaxHandler{settings: deps.CoretaxSettings{SellerTIN: "9999999999999999", SellerIDTKU: "9999999999999999000000"}}
	inv := Invoice{
		InvoiceNo:   "INV/2026/0001",
		InvoiceDate: time.Date(2026, 5, 13, 0, 0, 0, 0, time.UTC),
	}
	client := clients.Client{
		Name:        "PT Buyer",
		NPWP:        &npwp,
		Address:     &addr,
		Email:       &email,
		CountryCode: "IDN",
	}
	bulk := h.buildBulk(inv, nil, client)
	if len(bulk.Invoices) != 1 {
		t.Fatalf("want 1 invoice, got %d", len(bulk.Invoices))
	}
	tx := bulk.Invoices[0]
	if tx.BuyerIDTKU != npwp+"000000" {
		t.Fatalf("want BuyerIDTKU fallback %q, got %q", npwp+"000000", tx.BuyerIDTKU)
	}
	if tx.BuyerDocument != "TIN" {
		t.Fatalf("want BuyerDocument TIN, got %q", tx.BuyerDocument)
	}
	if tx.TrxCode != "04" {
		t.Fatalf("want default TrxCode 04, got %q", tx.TrxCode)
	}
	if tx.TaxInvoiceOpt != "Normal" {
		t.Fatalf("want default TaxInvoiceOpt Normal, got %q", tx.TaxInvoiceOpt)
	}
	if tx.TaxInvoiceDate != "2026-05-13" {
		t.Fatalf("want date 2026-05-13, got %q", tx.TaxInvoiceDate)
	}
	if !strings.HasPrefix(tx.BuyerAdress, "Jl. Kelapa") {
		t.Fatalf("BuyerAdress not propagated: %q", tx.BuyerAdress)
	}
}

func TestBuildBulk_BuyerWithoutNPWPUsesPassport(t *testing.T) {
	t.Parallel()
	h := &CoretaxHandler{settings: deps.CoretaxSettings{SellerTIN: "x"}}
	inv := Invoice{InvoiceDate: time.Now()}
	client := clients.Client{Name: "Foreign Buyer", CountryCode: "SGP"}
	bulk := h.buildBulk(inv, nil, client)
	tx := bulk.Invoices[0]
	if tx.BuyerDocument != "Passport" {
		t.Fatalf("want Passport for no-NPWP buyer, got %q", tx.BuyerDocument)
	}
	if tx.BuyerCountry != "SGP" {
		t.Fatalf("want country SGP, got %q", tx.BuyerCountry)
	}
}

func TestNormalizeMoney_StripsScientific(t *testing.T) {
	t.Parallel()
	cases := []struct{ in, want string }{
		{"", "0"},
		{"1e6", "1000000"},
		{"1.5e3", "1500"},
		{"100000.00", "100000"},
		{"invalid", "0"},
	}
	for _, c := range cases {
		got := normalizeMoney(c.in)
		if got != c.want {
			t.Errorf("normalizeMoney(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
