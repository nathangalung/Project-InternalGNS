package invoices

import (
	"encoding/xml"
	"errors"
	"fmt"
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
	// A void invoice is never filed; its Pengganti is.
	if inv.Status == StatusCancelled {
		httperr.Render(w, httperr.UnprocessableDetail(
			"Invoice yang dibatalkan tidak dapat diekspor ke Coretax.", nil))
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

	if verr := validateBuyerIdentity(client); verr != nil {
		httperr.Render(w, httperr.UnprocessableDetail(buyerIdentityMessage([]string{client.Name}), nil))
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
	buyerTIN := buyerTin(client)
	buyerIDTKU := strDeref(client.TkuID)
	if buyerIDTKU == "" && buyerTIN != "" {
		// DJP convention: headquarters branch suffix when no TKU recorded.
		buyerIDTKU = buyerTIN + "000000"
	}
	buyerDoc := "TIN"
	if buyerTIN == "" {
		// A foreign buyer with no TIN is filed on an alt document. An
		// Indonesian one never reaches here: validateBuyerIdentity refuses
		// the export first.
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
	price, discount := lineGrossAndDiscount(it)
	return coretaxGoodService{
		Opt:           opt,
		Code:          strDeref(it.ItemCode),
		Name:          it.ItemName,
		Unit:          unit,
		Price:         price,
		Qty:           normalizeMoney(it.Qty),
		TotalDiscount: discount,
		TaxBase:       normalizeMoneyPtr(it.Dpp),
		OtherTaxBase:  normalizeMoneyPtr(it.DppNilaiLain),
		VATRate:       normalizeMoneyPtr(it.PpnRate),
		VAT:           normalizeMoneyPtr(it.PpnAmount),
		STLGRate:      "0",
		STLG:          "0",
	}
}

// lineGrossAndDiscount files the gross price.
// DJP checks Price * Qty - TotalDiscount = TaxBase per line. The stored net
// unit price is rounded, so filing it with no discount misses the per-line
// DPP by that rounding. The discount is the gross line amount, rounded per
// line as fn_create_invoice does for the header total_discount, minus the
// DPP. A legacy line without a gross price files its net price, and a
// rounding shortfall is never filed as a negative discount.
func lineGrossAndDiscount(it InvoiceItem) (string, string) {
	price := normalizeMoney(it.UnitPrice)
	if it.GrossUnitPrice != nil && strings.TrimSpace(*it.GrossUnitPrice) != "" {
		price = normalizeMoney(*it.GrossUnitPrice)
	}
	// normalizeMoney always yields a valid decimal.
	gross := decimal.RequireFromString(price).Mul(decimal.RequireFromString(normalizeMoney(it.Qty)))
	disc := gross.Round(2).Sub(decimal.RequireFromString(normalizeMoneyPtr(it.Dpp)))
	if !disc.IsPositive() {
		return price, "0"
	}
	return price, disc.String()
}

// npwpDigits is the NPWP length Coretax accepts for an Indonesian buyer.
const npwpDigits = 16

// ErrBuyerIdentity marks a buyer Coretax would reject.
var ErrBuyerIdentity = errors.New("coretax buyer identity invalid")

// normalizeNPWP drops the separators DJP prints and reports whether what is
// left is a full-length NPWP.
func normalizeNPWP(raw string) (string, bool) {
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == '-' || r == ' ':
		default:
			return "", false
		}
	}
	out := b.String()
	return out, len(out) == npwpDigits
}

// isIndonesianBuyer treats a blank country as IDN, as the XML default does.
func isIndonesianBuyer(c clients.Client) bool {
	return c.CountryCode == "" || strings.EqualFold(c.CountryCode, "IDN")
}

// buyerTin emits an Indonesian NPWP as the digits Coretax validates and
// leaves a foreign buyer's own tax id untouched.
func buyerTin(c clients.Client) string {
	raw := strings.TrimSpace(strDeref(c.NPWP))
	if digits, ok := normalizeNPWP(raw); ok {
		return digits
	}
	return raw
}

// validateBuyerIdentity refuses an Indonesian buyer without a valid NPWP.
// Filing them as a passport holder with no document number produces a tax
// invoice DJP cannot match to the buyer.
func validateBuyerIdentity(c clients.Client) error {
	if _, ok := normalizeNPWP(strings.TrimSpace(strDeref(c.NPWP))); ok {
		return nil
	}
	if isIndonesianBuyer(c) {
		return fmt.Errorf("client %d: %w", c.ID, ErrBuyerIdentity)
	}
	return nil
}

// buyerIdentityMessage is the toast shown when an export is refused.
func buyerIdentityMessage(names []string) string {
	return "Ekspor Coretax memerlukan NPWP 16 digit untuk pembeli Indonesia. " +
		"Lengkapi NPWP klien: " + strings.Join(names, ", ") + "."
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
