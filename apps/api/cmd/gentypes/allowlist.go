package main

// API module import path.
const module = "github.com/nathangalung/internalgns/apps/api"

// entry maps one Go type.
// Input marks a request body: Go decodes an absent key as nil, so a nullable
// field of an input may be omitted.
type entry struct {
	Go    string
	TS    string
	Input bool
}

// pkg is one allowlisted package.
type pkg struct {
	Path  string
	Types []entry
}

// allowlist names every wire type.
// A DTO reaches the web only through this list; TestAllowlist_CoversJSONTypes
// fails when an exported json-tagged type is neither here nor in skipped.
var allowlist = []pkg{
	{"internal/auth", []entry{
		{Go: "LoginRequest", TS: "LoginInput", Input: true},
		{Go: "LoginResponse", TS: "LoginResponse"},
		{Go: "RefreshRequest", TS: "RefreshInput", Input: true},
		{Go: "LogoutRequest", TS: "LogoutInput", Input: true},
		{Go: "MeUser", TS: "MeUser"},
		{Go: "ChangeOwnPasswordRequest", TS: "ChangeOwnPasswordInput", Input: true},
	}},
	{"internal/users", []entry{
		{Go: "Role", TS: "Role"},
		{Go: "User", TS: "UserRow"},
		{Go: "CreateUserRequest", TS: "CreateUserInput", Input: true},
		{Go: "UpdateUserRequest", TS: "UpdateUserInput", Input: true},
		{Go: "ChangePasswordRequest", TS: "ChangeUserPasswordInput", Input: true},
	}},
	{"internal/clients", []entry{
		{Go: "Client", TS: "ClientRow"},
		{Go: "Contact", TS: "ContactRow"},
		{Go: "SearchResult", TS: "ClientSearchHit"},
		{Go: "Summary", TS: "ClientSummary"},
		{Go: "CreateClientRequest", TS: "CreateClientInput", Input: true},
		{Go: "UpdateClientRequest", TS: "UpdateClientInput", Input: true},
		{Go: "CreateContactRequest", TS: "CreateContactInput", Input: true},
		{Go: "UpdateContactRequest", TS: "UpdateContactInput", Input: true},
	}},
	{"internal/countries", []entry{
		{Go: "Country", TS: "CountryRow"},
	}},
	{"internal/units", []entry{
		{Go: "Unit", TS: "UnitRow"},
	}},
	{"internal/vendors", []entry{
		{Go: "Vendor", TS: "VendorRow"},
		{Go: "ItemByVendor", TS: "VendorItemRow"},
		{Go: "CreateVendorRequest", TS: "CreateVendorInput", Input: true},
		{Go: "UpdateVendorRequest", TS: "UpdateVendorInput", Input: true},
		{Go: "ContactInfo", TS: "VendorContactInfo"},
	}},
	{"internal/items", []entry{
		{Go: "Item", TS: "ItemRow"},
		{Go: "VendorForItem", TS: "ItemVendorRow"},
		{Go: "PriceHistory", TS: "ItemPriceHistoryRow"},
		{Go: "CreateItemRequest", TS: "CreateItemInput", Input: true},
		{Go: "UpdateItemRequest", TS: "UpdateItemInput", Input: true},
		{Go: "AddVendorToItemRequest", TS: "AddVendorToItemInput", Input: true},
		{Go: "MatchedItemWithVendor", TS: "MatchedItemWithVendor"},
		{Go: "MatchRowInput", TS: "MatchRowInput", Input: true},
		{Go: "MatchRowResult", TS: "MatchRowResult"},
		{Go: "MatchRowsRequest", TS: "MatchRowsInput", Input: true},
		{Go: "MatchRowsResponse", TS: "MatchRowsResponse"},
		{Go: "AdvancedSearchHit", TS: "AdvancedSearchHit"},
		{Go: "AdvancedSearchResponse", TS: "AdvancedSearchResponse"},
	}},
	{"internal/quotations", []entry{
		{Go: "Status", TS: "QuotationStatus"},
		{Go: "Transition", TS: "QuotationTransition"},
		{Go: "Quotation", TS: "QuotationHeader"},
		{Go: "QuotationItem", TS: "QuotationItemRow"},
		{Go: "StatusHistoryEntry", TS: "QuotationStatusEvent"},
		{Go: "QuotationDetail", TS: "QuotationDetail"},
		{Go: "RevisionRow", TS: "QuotationRevisionRow"},
		{Go: "ListRow", TS: "QuotationListRow"},
		{Go: "StatusCount", TS: "QuotationStatusCount"},
		{Go: "CreateItem", TS: "QuotationItemInput", Input: true},
		{Go: "CreateRequest", TS: "QuotationCreateInput", Input: true},
		{Go: "UpdateRequest", TS: "QuotationUpdateInput", Input: true},
		{Go: "ChangeStatusRequest", TS: "QuotationStatusInput", Input: true},
		{Go: "SendRequest", TS: "QuotationSendInput", Input: true},
		{Go: "ReviseRequest", TS: "QuotationReviseInput", Input: true},
		{Go: "ChangeContactRequest", TS: "QuotationContactInput", Input: true},
		{Go: "CreatedResponse", TS: "QuotationCreated"},
		{Go: "UpdatedResponse", TS: "QuotationSaved"},
		{Go: "ItemRequestRow", TS: "QuotationItemRequestRow"},
		{Go: "ItemRequestCreate", TS: "QuotationItemRequestCreateInput", Input: true},
		{Go: "ItemRequestUpdate", TS: "QuotationItemRequestUpdateInput", Input: true},
		{Go: "RFQRows", TS: "QuotationRfqRows"},
	}},
	{"internal/purchaseorders", []entry{
		{Go: "Status", TS: "PoBackendStatus"},
		{Go: "Transition", TS: "PoTransition"},
		{Go: "PurchaseOrder", TS: "PurchaseOrderRow"},
		{Go: "PurchaseOrderItem", TS: "PurchaseOrderItemRow"},
		{Go: "StatusHistoryEntry", TS: "PoStatusEvent"},
		{Go: "ChangeStatusRequest", TS: "PoStatusInput", Input: true},
		{Go: "UpdateFileRequest", TS: "PoFileInput", Input: true},
		{Go: "UpdateNotesRequest", TS: "PoNotesInput", Input: true},
		{Go: "UpdateDetailsRequest", TS: "PoDetailsInput", Input: true},
		{Go: "UpdateItemsRequest", TS: "PoUpdateItemsInput", Input: true},
		{Go: "UpdateItemsLine", TS: "PoItemInput", Input: true},
		{Go: "UpdatedResponse", TS: "PoSaved"},
		{Go: "IssueKind", TS: "PoIssueKind"},
		{Go: "GapCode", TS: "PoGapCode"},
		{Go: "CompletenessGap", TS: "PoCompletenessGap"},
		{Go: "CompletenessIssue", TS: "PoCompletenessIssue"},
		{Go: "IncompleteProblem", TS: "PoIncompleteProblem"},
	}},
	{"internal/invoices", []entry{
		{Go: "Status", TS: "InvoiceBackendStatus"},
		{Go: "Transition", TS: "InvoiceTransition"},
		{Go: "Invoice", TS: "InvoiceBackendRow"},
		{Go: "InvoiceDetail", TS: "InvoiceDetail"},
		{Go: "InvoiceItem", TS: "InvoiceItemRow"},
		{Go: "StatusHistoryEntry", TS: "InvoiceStatusEvent"},
		{Go: "Summary", TS: "InvoiceSummary"},
		{Go: "ChangeStatusRequest", TS: "ChangeInvoiceStatusInput", Input: true},
		{Go: "UpdateDatesRequest", TS: "UpdateInvoiceDatesInput", Input: true},
		{Go: "DatesUpdatedResponse", TS: "InvoiceDatesSaved"},
	}},
	{"internal/dashboard", []entry{
		{Go: "Summary", TS: "DashboardSummary"},
		{Go: "StatusCount", TS: "DashboardStatusCount"},
		{Go: "TimeseriesPoint", TS: "DashboardTimeseriesPoint"},
	}},
	{"internal/shared/assetproxy", []entry{
		{Go: "PresignUpload", TS: "PresignUpload"},
		{Go: "PresignDownload", TS: "PresignDownload"},
		{Go: "PresignFileDownload", TS: "PresignFileDownload"},
		{Go: "KeyRequest", TS: "ObjectKeyInput", Input: true},
	}},
	{"internal/shared/httperr", []entry{
		{Go: "Error", TS: "ProblemDetail"},
	}},
}
