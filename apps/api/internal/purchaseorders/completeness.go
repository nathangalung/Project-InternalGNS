package purchaseorders

import (
	"strconv"
	"strings"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// Master data gating PO work.
// The browser used to run this check by fetching every item and then every
// vendor, and let the promotion through while those requests were still in
// flight. The server owns it now, and answers in one round trip.

// ClientCompleteness is the client gate.
// It is the client side of the ON_PROGRESS and DELIVERED gate.
type ClientCompleteness struct {
	ID           int64   `db:"id"`
	Name         string  `db:"name"`
	Number       *string `db:"number"`
	Npwp         *string `db:"npwp"`
	CountryCode  string  `db:"country_code"`
	Address      *string `db:"address"`
	ContactName  *string `db:"contact_name"`
	ContactEmail *string `db:"contact_email"`
	ContactPhone *string `db:"contact_phone"`
	// The quotation's chosen contact was deactivated.
	ContactInactive bool `db:"contact_inactive"`
}

// gateRow carries number and client.
// The PO's own number, read in the same query as its client.
type gateRow struct {
	ClientCompleteness
	PoNumber *string `db:"po_number"`
}

// VendorCompleteness is a line's vendor.
type VendorCompleteness struct {
	ID           int64   `db:"id"`
	Name         string  `db:"name"`
	Location     *string `db:"location"`
	ContactEmail *string `db:"contact_email"`
	ContactPhone *string `db:"contact_phone"`
}

// LineCompleteness is a PO line.
type LineCompleteness struct {
	ItemType        string  `db:"item_type"`
	ShipDestination *string `db:"ship_destination"`
}

// CompletenessGap is one missing field.
// Code is the stable tag the web branches on; Label is the Indonesian field
// name shown to the user.
type CompletenessGap struct {
	Code  GapCode `json:"code"`
	Label string  `json:"label"`
}

// CompletenessIssue is one record's gaps.
// Kind and ID name the record to open (the PO itself for its number and
// shipping), and
// Message is the Indonesian sentence the problem's fields carry for it.
type CompletenessIssue struct {
	Kind    IssueKind         `json:"kind"`
	ID      int64             `json:"id"`
	Name    string            `json:"name,omitempty"`
	Message string            `json:"message"`
	Missing []CompletenessGap `json:"missing"`
}

// IncompleteProblem is the gate's 422.
// It is the RFC 7807 body plus the structured gaps, so the web renders the
// issues without parsing the prose in Fields.
type IncompleteProblem struct {
	httperr.Error
	Issues []CompletenessIssue `json:"issues"`
}

// IncompleteCode tags the gate's refusal.
const IncompleteCode = "po_incomplete"

// IssueKind names the record.
type IssueKind string

const (
	KindPurchaseOrder IssueKind = "po"
	KindClient        IssueKind = "client"
	KindVendor        IssueKind = "vendor"
	KindShipping      IssueKind = "shipping"
)

// GapCode tags one missing field.
type GapCode string

const (
	GapPoNumber        GapCode = "po_number"
	GapClientNumber    GapCode = "client_number"
	GapClientNpwp      GapCode = "client_npwp"
	GapClientAddress   GapCode = "client_address"
	GapContactInactive GapCode = "contact_inactive"
	GapContactName     GapCode = "contact_name"
	GapContactReach    GapCode = "contact_reach"
	GapVendorLocation  GapCode = "vendor_location"
	GapVendorReach     GapCode = "vendor_reach"
	GapShippingAddress GapCode = "shipping_address"
)

// scopeWord names kinds in Indonesian.
// It keys the legacy fields ("klien:<id>") and starts each sentence.
var scopeWord = map[IssueKind]string{
	KindPurchaseOrder: "po",
	KindClient:        "klien",
	KindVendor:        "vendor",
	KindShipping:      "pengiriman",
}

const (
	poNumberMessage = "No. PO klien belum diisi"
	shippingMessage = "Alamat pengiriman belum diisi"
)

func filled(v *string) bool {
	return v != nil && strings.TrimSpace(*v) != ""
}

// missingClientFields lists document client gaps.
// Nomor TKU is absent on purpose: the Coretax export derives it from the
// NPWP when the client has none recorded, so the NPWP is the real
// requirement.
func missingClientFields(c ClientCompleteness) []CompletenessGap {
	var missing []CompletenessGap
	if !filled(c.Number) {
		missing = append(missing, CompletenessGap{GapClientNumber, "Nomor Klien"})
	}
	if !filled(c.Npwp) {
		missing = append(missing, CompletenessGap{GapClientNpwp, "NPWP"})
	} else if msg := validate.ClientNPWP(c.CountryCode, c.Npwp); msg != "" {
		// The invoice issued at DELIVERED goes to Coretax, which refuses it.
		missing = append(missing, CompletenessGap{GapClientNpwp, "NPWP 16 digit"})
	}
	if !filled(c.Address) {
		missing = append(missing, CompletenessGap{GapClientAddress, "Alamat"})
	}
	// A deactivated contact cannot be edited, so the quotation must pick
	// another one; its own fields are moot until then.
	if c.ContactInactive {
		return append(missing, CompletenessGap{GapContactInactive, "Narahubung aktif"})
	}
	if !filled(c.ContactName) {
		missing = append(missing, CompletenessGap{GapContactName, "Nama Narahubung"})
	}
	if !filled(c.ContactEmail) && !filled(c.ContactPhone) {
		missing = append(missing, CompletenessGap{GapContactReach, "Email atau No HP Narahubung"})
	}
	return missing
}

// missingVendorFields lists vendor gaps.
func missingVendorFields(v VendorCompleteness) []CompletenessGap {
	var missing []CompletenessGap
	if !filled(v.Location) {
		missing = append(missing, CompletenessGap{GapVendorLocation, "Lokasi"})
	}
	if !filled(v.ContactEmail) && !filled(v.ContactPhone) {
		missing = append(missing, CompletenessGap{GapVendorReach, "Email atau Nomor Telepon"})
	}
	return missing
}

// recordIssue builds a party issue.
func recordIssue(kind IssueKind, id int64, name string, missing []CompletenessGap) CompletenessIssue {
	labels := make([]string, len(missing))
	for i, g := range missing {
		labels[i] = g.Label
	}
	return CompletenessIssue{
		Kind: kind, ID: id, Name: name, Missing: missing,
		Message: "Data " + scopeWord[kind] + " " + name + " belum lengkap: " + strings.Join(labels, ", "),
	}
}

// poNumberIssues flags a numberless PO.
// The PO number is the client's own, entered on the PO, so the gap is keyed
// by the PO.
func poNumberIssues(poID int64, number *string) []CompletenessIssue {
	if filled(number) {
		return nil
	}
	return []CompletenessIssue{{
		Kind: KindPurchaseOrder, ID: poID, Message: poNumberMessage,
		Missing: []CompletenessGap{{GapPoNumber, "No. PO Klien"}},
	}}
}

// shippingIssues flags unaddressed goods.
// The shipping address is optional on the quotation and required here. The
// shipping line's address covers every product; without one, each product
// line must carry its own, so a PO with no shipping line is not exempt. The
// gap is keyed by the PO, since the PO editor holds the one address.
func shippingIssues(poID int64, lines []LineCompleteness) []CompletenessIssue {
	blankProduct := false
	for _, l := range lines {
		switch {
		case l.ItemType == "shipping" && filled(l.ShipDestination):
			return nil
		case l.ItemType == "product" && !filled(l.ShipDestination):
			blankProduct = true
		}
	}
	if !blankProduct {
		return nil
	}
	return []CompletenessIssue{{
		Kind: KindShipping, ID: poID, Message: shippingMessage,
		Missing: []CompletenessGap{{GapShippingAddress, "Alamat Pengiriman"}},
	}}
}

// completenessFields keys sentences per record.
func completenessFields(issues []CompletenessIssue) map[string]string {
	fields := make(map[string]string, len(issues))
	for _, is := range issues {
		fields[scopeWord[is.Kind]+":"+strconv.FormatInt(is.ID, 10)] = is.Message
	}
	return fields
}

// incompleteProblem builds the gate refusal.
func incompleteProblem(issues []CompletenessIssue) IncompleteProblem {
	e := httperr.Unprocessable(completenessFields(issues))
	e.Code = IncompleteCode
	return IncompleteProblem{Error: e, Issues: issues}
}
