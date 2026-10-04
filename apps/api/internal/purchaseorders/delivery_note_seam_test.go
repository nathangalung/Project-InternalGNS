package purchaseorders

import "context"

// Party block test seam.
// dnData is unexported and testutil imports this package, so the
// integration assertions live in purchaseorders_test and reach buildData here.
func (h *DeliveryNoteHandler) PDFPartyForTest(ctx context.Context, po PurchaseOrder) (name, address string, err error) {
	d, err := h.buildData(ctx, po, "", nil)
	return d.CompanyName, d.CompanyAddress, err
}
