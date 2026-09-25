package purchaseorders

import (
	"strconv"
	"strings"
)

// Master data gating PO work.
// The browser used to run this check by fetching every item and then every
// vendor, and let the promotion through while those requests were still in
// flight. The server owns it now, and answers in one round trip.

// ClientCompleteness is the client gate.
// It is the client side of the ON_PROGRESS gate.
type ClientCompleteness struct {
	ID           int64   `db:"id"`
	Name         string  `db:"name"`
	Number       *string `db:"number"`
	Npwp         *string `db:"npwp"`
	Address      *string `db:"address"`
	ContactName  *string `db:"contact_name"`
	ContactEmail *string `db:"contact_email"`
	ContactPhone *string `db:"contact_phone"`
}

// VendorCompleteness is a line's vendor.
type VendorCompleteness struct {
	ID           int64   `db:"id"`
	Name         string  `db:"name"`
	Location     *string `db:"location"`
	ContactEmail *string `db:"contact_email"`
	ContactPhone *string `db:"contact_phone"`
}

// CompletenessIssue lists a record's gaps.
type CompletenessIssue struct {
	Scope   string   `json:"scope"`
	ID      int64    `json:"id"`
	Name    string   `json:"name"`
	Missing []string `json:"missing"`
}

const (
	scopeClient = "klien"
	scopeVendor = "vendor"
)

func filled(v *string) bool {
	return v != nil && strings.TrimSpace(*v) != ""
}

// missingClientFields lists document client gaps.
// Nomor TKU is absent on purpose: the Coretax export derives it from the
// NPWP when the client has none recorded, so the NPWP is the real
// requirement.
func missingClientFields(c ClientCompleteness) []string {
	var missing []string
	if !filled(c.Number) {
		missing = append(missing, "Nomor Klien")
	}
	if !filled(c.Npwp) {
		missing = append(missing, "NPWP")
	}
	if !filled(c.Address) {
		missing = append(missing, "Alamat")
	}
	if !filled(c.ContactName) {
		missing = append(missing, "Nama Narahubung")
	}
	if !filled(c.ContactEmail) && !filled(c.ContactPhone) {
		missing = append(missing, "Email atau Nomor Telepon Narahubung")
	}
	return missing
}

// missingVendorFields lists vendor gaps.
func missingVendorFields(v VendorCompleteness) []string {
	var missing []string
	if !filled(v.Location) {
		missing = append(missing, "Lokasi")
	}
	if !filled(v.ContactEmail) && !filled(v.ContactPhone) {
		missing = append(missing, "Email atau Nomor Telepon")
	}
	return missing
}

// completenessFields renders problem field errors.
func completenessFields(issues []CompletenessIssue) map[string]string {
	fields := make(map[string]string, len(issues))
	for _, is := range issues {
		key := is.Scope + ":" + strconv.FormatInt(is.ID, 10)
		fields[key] = "Data " + is.Scope + " " + is.Name +
			" belum lengkap: " + strings.Join(is.Missing, ", ")
	}
	return fields
}
