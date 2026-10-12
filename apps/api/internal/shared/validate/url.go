package validate

import (
	"net/url"
	"strings"
)

// ProductURLMessage sits on a product link.
const ProductURLMessage = "Link produk harus diawali http:// atau https://."

// StoreURLMessage sits on a store link.
const StoreURLMessage = "Link toko harus diawali http:// atau https://."

// maxURLLen bounds a stored link.
const maxURLLen = 2048

// ProductURL checks a product link.
// The link is where a vendor sells one item (vendor_products.product_url).
// s is checked as given; callers trim first and treat blank as no link. It
// returns "" when s passes.
func ProductURL(s string) string {
	if !webURL(s) {
		return ProductURLMessage
	}
	return ""
}

// StoreURL checks a vendor's store link.
// Same rule as ProductURL, for vendors.store_url.
func StoreURL(s string) string {
	if !webURL(s) {
		return StoreURLMessage
	}
	return ""
}

// webURL reports a safe web address.
// Only an http or https address with a host and no spaces passes, so the
// web can render it as a link that never runs script.
func webURL(s string) bool {
	if len(s) > maxURLLen || strings.ContainsAny(s, " \t\r\n") {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}
