package invoices

import (
	"encoding/xml"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/shopspring/decimal"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
)

// CoretaxHandler renders the DJP e-faktur XML payload.
//
// Schema reference: "Manual Book of CoreTax: Export Faktur Pajak Keluaran"
// (Direktorat Jenderal Pajak / imamatek). Root element `TaxInvoiceBulk` carries
// the seller `TIN`, then a `ListOfTaxInvoice` of one `TaxInvoice` per upload.
// Field names use DJP's casing — including the literal `BuyerAdress` typo —
// because the coretax importer does string-match validation.
type CoretaxHandler struct {
	repo          *Repo
	clients       *clients.Repo
	settings      deps.CoretaxSettings
	templatesRoot string
}

func NewCoretaxHandler(repo *Repo, c *clients.Repo, s deps.CoretaxSettings, templatesRoot string) *CoretaxHandler {
	return &CoretaxHandler{repo: repo, clients: c, settings: s, templatesRoot: templatesRoot}
}

type coretaxGoodService struct {
	XMLName       xml.Name `xml:"GoodService"`
	Opt           string   `xml:"Opt"`
	Code          string   `xml:"Code"`
	Name          string   `xml:"Name"`
	Unit          string   `xml:"Unit"`
	Price         string   `xml:"Price"`
	Qty           string   `xml:"Qty"`
	TotalDiscount string   `xml:"TotalDiscount"`
	TaxBase       string   `xml:"TaxBase"`
	OtherTaxBase  string   `xml:"OtherTaxBase"`
	VATRate       string   `xml:"VATRate"`
	VAT           string   `xml:"VAT"`
	STLGRate      string   `xml:"STLGRate"`
	STLG          string   `xml:"STLG"`
}

type coretaxTaxInvoice struct {
	XMLName         xml.Name             `xml:"TaxInvoice"`
	TaxInvoiceDate  string               `xml:"TaxInvoiceDate"`
	TaxInvoiceOpt   string               `xml:"TaxInvoiceOpt"`
	TrxCode         string               `xml:"TrxCode"`
	AddInfo         string               `xml:"AddInfo"`
	CustomDoc       string               `xml:"CustomDoc"`
	RefDesc         string               `xml:"RefDesc"`
	FacilityStamp   string               `xml:"FacilityStamp"`
	SellerIDTKU     string               `xml:"SellerIDTKU"`
	BuyerTin        string               `xml:"BuyerTin"`
	BuyerDocument   string               `xml:"BuyerDocument"`
	BuyerCountry    string               `xml:"BuyerCountry"`
	BuyerDocumentNo string               `xml:"BuyerDocumentNumber"`
	BuyerName       string               `xml:"BuyerName"`
	BuyerAdress     string               `xml:"BuyerAdress"`
	BuyerEmail      string               `xml:"BuyerEmail"`
	BuyerIDTKU      string               `xml:"BuyerIDTKU"`
	ListOfGoodSrv   []coretaxGoodService `xml:"ListOfGoodService>GoodService"`
}

type coretaxBulk struct {
	XMLName  xml.Name            `xml:"TaxInvoiceBulk"`
	TIN      string              `xml:"TIN"`
	Invoices []coretaxTaxInvoice `xml:"ListOfTaxInvoice>TaxInvoice"`
}

// Export handles GET /invoices/{id}/coretax.xml.
func (h *CoretaxHandler) Export(w http.ResponseWriter, r *http.Request) {
	if h.settings.SellerTIN == "" {
		httperr.Render(w, httperr.ServiceUnavailable("coretax seller TIN not configured"))
		return
	}
	if h.settings.SellerIDTKU == "" {
		httperr.Render(w, httperr.ServiceUnavailable("coretax seller IDTKU not configured"))
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httperr.Render(w, httperr.BadRequest("invalid id"))
		return
	}

	inv, err := h.repo.GetByID(r.Context(), id)
	if errors.Is(err, ErrNotFound) {
		httperr.Render(w, httperr.NotFound("invoice not found"))
		return
	}
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	items, err := h.repo.ListItems(r.Context(), id)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	client, err := h.clients.GetByID(r.Context(), inv.CompanyClientID)
	if err != nil {
		httperr.RenderDBErr(w, err)
		return
	}

	bulk := h.buildBulk(inv, items, client)

	body, err := xml.MarshalIndent(bulk, "", "  ")
	if err != nil {
		httperr.Render(w, httperr.Internal("xml marshal failed"))
		return
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+inv.InvoiceNo+`.xml"`)
	_, _ = w.Write([]byte(xml.Header))
	_, _ = w.Write(body)
}

func (h *CoretaxHandler) buildBulk(inv Invoice, items []InvoiceItem, client clients.Client) coretaxBulk {
	return coretaxBulk{
		TIN:      h.settings.SellerTIN,
		Invoices: []coretaxTaxInvoice{coretaxInvoiceFor(h.settings, inv, items, client)},
	}
}

// coretaxInvoiceFor maps one invoice + its items + buyer into a TaxInvoice.
// Shared by the single-invoice XML export and the bulk XLSX export so the
// field derivation lives in one place.
func coretaxInvoiceFor(settings deps.CoretaxSettings, inv Invoice, items []InvoiceItem, client clients.Client) coretaxTaxInvoice {
	trxCode := "04"
	if inv.TaxTransactionCode != nil && *inv.TaxTransactionCode != "" {
		trxCode = *inv.TaxTransactionCode
	}
	fakturType := "Normal"
	if inv.FakturType != nil && *inv.FakturType != "" {
		fakturType = *inv.FakturType
	}

	buyerCountry := "IDN"
	if client.CountryCode != "" {
		buyerCountry = client.CountryCode
	}
	buyerTIN := strDeref(client.NPWP)
	buyerIDTKU := strDeref(client.TkuID)
	if buyerIDTKU == "" && buyerTIN != "" {
		// DJP convention: headquarters branch suffix when no TKU recorded.
		buyerIDTKU = buyerTIN + "000000"
	}
	buyerDoc := "TIN"
	if buyerTIN == "" {
		// DJP requires an alt-document identifier when buyer has no NPWP.
		buyerDoc = "Passport"
	}

	goods := make([]coretaxGoodService, 0, len(items))
	for _, it := range items {
		goods = append(goods, buildGoodService(it))
	}

	return coretaxTaxInvoice{
		TaxInvoiceDate: inv.InvoiceDate.Format("2006-01-02"),
		TaxInvoiceOpt:  fakturType,
		TrxCode:        trxCode,
		RefDesc:        inv.InvoiceNo,
		SellerIDTKU:    settings.SellerIDTKU,
		BuyerTin:       buyerTIN,
		BuyerDocument:  buyerDoc,
		BuyerCountry:   buyerCountry,
		BuyerName:      client.Name,
		BuyerAdress:    strDeref(client.Address),
		BuyerEmail:     strDeref(client.Email),
		BuyerIDTKU:     buyerIDTKU,
		ListOfGoodSrv:  goods,
	}
}

// buildGoodService maps an invoice line to the Coretax `GoodService` element.
//
// DB stores `goods_or_service` as 'B' (Barang / product) or 'J' (Jasa / shipping
// service). Coretax XML `<Opt>` uses 'A' for Barang and 'B' for Jasa — the
// remap is intentional, not a typo. Unit falls back to "UM.0033" (general
// "Other/Lainnya") when no Coretax code is recorded for the unit.
func buildGoodService(it InvoiceItem) coretaxGoodService {
	opt := "A"
	if it.GoodsOrService != nil && strings.EqualFold(*it.GoodsOrService, "J") {
		opt = "B"
	}
	unit := "UM.0033"
	if it.UnitCoretaxCode != nil && *it.UnitCoretaxCode != "" {
		unit = *it.UnitCoretaxCode
	}
	return coretaxGoodService{
		Opt:           opt,
		Code:          strDeref(it.ItemCode),
		Name:          it.ItemName,
		Unit:          unit,
		Price:         normalizeMoney(it.UnitPrice),
		Qty:           normalizeMoney(it.Qty),
		TotalDiscount: "0",
		TaxBase:       normalizeMoneyPtr(it.Dpp),
		OtherTaxBase:  normalizeMoneyPtr(it.DppNilaiLain),
		VATRate:       normalizeMoneyPtr(it.PpnRate),
		VAT:           normalizeMoneyPtr(it.PpnAmount),
		STLGRate:      "0",
		STLG:          "0",
	}
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// normalizeMoney parses a decimal string and re-renders without scientific
// notation. Coretax rejects numerics in scientific form.
func normalizeMoney(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "0"
	}
	d, err := decimal.NewFromString(s)
	if err != nil {
		return "0"
	}
	return d.String()
}

func normalizeMoneyPtr(p *string) string {
	if p == nil {
		return "0"
	}
	return normalizeMoney(*p)
}
