package queries

import (
	"fmt"
	"sort"
	"strings"
)

// All query keys repos require.
var RequiredKeys = []string{
	"auth.refresh_insert",
	"auth.refresh_lookup",
	"auth.refresh_purge_expired",
	"auth.refresh_redeem",
	"auth.refresh_revoke_token",
	"auth.refresh_revoke_user",
	"clients.create",
	"clients.create_contact",
	"clients.get_by_id",
	"clients.list_base",
	"clients.list_contacts",
	"clients.list_count_base",
	"clients.search",
	"clients.summary",
	"clients.update",
	"clients.update_logo",
	"countries.list_all",
	"dashboard.summary",
	"dashboard.ts_invoice",
	"dashboard.ts_ppn",
	"dashboard.ts_profit",
	"dashboard.ts_quotation",
	"dashboard.ts_revenue",
	"invoices.change_status",
	"invoices.get_by_id",
	"invoices.get_by_quotation",
	"invoices.list_base",
	"invoices.list_count_base",
	"invoices.list_items",
	"invoices.row_version",
	"invoices.summary",
	"invoices.update_attachment",
	"invoices.update_dates",
	"items.add_vendor",
	"items.create",
	"items.find_by_impa",
	"items.get_by_id",
	"items.list_base",
	"items.list_count_base",
	"items.list_vendors_for_item",
	"items.match_request",
	"items.match_with_vendor_by_id",
	"items.search",
	"items.search_request_history",
	"items.search_vendor_offers",
	"items.suggest_selling_prices",
	"items.update",
	"items.update_image",
	"purchase_orders.change_status",
	"purchase_orders.get_by_id",
	"purchase_orders.get_by_quotation",
	"purchase_orders.list_base",
	"purchase_orders.list_count_base",
	"purchase_orders.list_items",
	"purchase_orders.row_version",
	"purchase_orders.update_file",
	"purchase_orders.update_items",
	"purchase_orders.update_items_versioned",
	"purchase_orders.update_notes",
	"quotations.fn_change_status",
	"quotations.fn_create",
	"quotations.fn_update",
	"quotations.fn_update_versioned",
	"quotations.get_header",
	"quotations.get_history",
	"quotations.get_items",
	"quotations.list_base",
	"quotations.list_count_base",
	"quotations.list_revisions",
	"quotations.qir_create",
	"quotations.qir_delete",
	"quotations.qir_get",
	"quotations.qir_list",
	"quotations.qir_update",
	"quotations.row_version",
	"quotations.stats",
	"units.list_all",
	"users.create",
	"users.exists_email_other",
	"users.get_by_email",
	"users.get_by_id",
	"users.list_base",
	"users.list_count_base",
	"users.update",
	"users.update_password",
	"vendors.create",
	"vendors.get_by_id",
	"vendors.list_base",
	"vendors.list_count_base",
	"vendors.list_items",
	"vendors.search",
	"vendors.update",
	"vendors.update_logo",
}

// Reports every missing required key.
func (s Store) Validate(required []string) error {
	var missing []string
	for _, name := range required {
		if _, ok := s[name]; !ok {
			missing = append(missing, name)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	sort.Strings(missing)
	return fmt.Errorf("queries: missing %d required block(s): %s",
		len(missing), strings.Join(missing, ", "))
}
