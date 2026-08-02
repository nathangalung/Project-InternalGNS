package pdfgen

import (
	"context"
	"os"
	"os/exec"
	"testing"
)

type smokeItem struct {
	No              int
	Qty, Unit, Name string
	ShipDestination string
}

// Full xelatex render proves logo staging.
func TestRenderDeliveryNoteWithAssets(t *testing.T) {
	if _, err := os.Stat("../../templates/assets/Logo_Vertical.png"); err != nil {
		t.Skip("assets missing")
	}
	if _, err := exec.LookPath("xelatex"); err != nil {
		t.Skip("xelatex missing")
	}
	r := NewRenderer("../../templates/documents")
	data := map[string]any{
		"DeliveryNoteNo": "DN-2640034/GNS/I/2026",
		"PONo":           "PO-XYZ/2026",
		"CompanyName":    "PT Sample",
		"CompanyAddress": "Jl. Test No. 1 Jakarta",
		"AttnName":       "Budi",
		"VesselName":     "MV Test",
		"DateLine":       "Jakarta, 8 July 2026",
		"Items":          []smokeItem{{1, "2", "PCS", "Life jacket", "Tg. Priok"}},
		"PreparedBy":     "Direktur",
		"SenderName":     "Direktur",
	}
	pdf, err := r.Render(context.Background(), "delivery_note/DeliveryNote.tex.tmpl", data)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if len(pdf) < 10_000 {
		t.Fatalf("pdf suspiciously small: %d bytes", len(pdf))
	}
}
