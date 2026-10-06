package pdfgen

import (
	"strings"
	"testing"
)

// Addresses read as one tidy line.
// Typed line breaks, stray spaces and doubled commas become one ", ", a
// glued postal code gets its space, and a list of house numbers keeps its
// own commas.
func TestNormalizeAddress(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"line breaks and stray spaces",
			"GEDUNG TCC LT 11 JL KH MAS MANSYUR KAV 126 ,  \n RT 009,  RW 003, KARET TENGSIN,  \n DKI JAKARTA 10220",
			"GEDUNG TCC LT 11 JL KH MAS MANSYUR KAV 126, RT 009, RW 003, KARET TENGSIN, DKI JAKARTA 10220"},
		{"a glued postal code", "CIRACAS JAKARTA TIMUR,13740", "CIRACAS JAKARTA TIMUR, 13740"},
		{"house number lists stay", "Blok G No. 2,6,8, Jl. Hayam wuruk No.2-5", "Blok G No. 2,6,8, Jl. Hayam wuruk No.2-5"},
		{"doubled and trailing commas", " , Jl. A,, Jakarta ,\r\n", "Jl. A, Jakarta"},
		{"blank", "  \n ", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := NormalizeAddress(c.in); got != c.want {
				t.Errorf("NormalizeAddress() = %q, want %q", got, c.want)
			}
		})
	}
}

// Addresses break between parts.
// A part that fits a line never splits, an abbreviation such as Lt. or Kav.
// stays with its number, and only the comma between parts is a break point.
func TestLatexAddress(t *testing.T) {
	got := LatexAddress("Gedung Wisma 46 Lt. 12,  Jl. Jend. Sudirman Kav. 1,\nJakarta Pusat 10220", 34)
	want := "Gedung~Wisma~46~Lt.~12, Jl.~Jend.~Sudirman~Kav.~1, Jakarta~Pusat~10220"
	if got != want {
		t.Errorf("LatexAddress() = %q, want %q", got, want)
	}
	long := LatexAddress("Kawasan Industri Pergudangan Terpadu Blok Sentral Nomor Duapuluh Satu", 34)
	if !strings.Contains(long, " ") {
		t.Errorf("a part longer than a line must still break: %q", long)
	}
	if !strings.Contains(LatexAddress("Jl. Raya No. 7", 4), "Jl.~Raya") {
		t.Error("an abbreviation stays with the next word even in a long part")
	}
	if got := LatexAddress("Jl. 50% & #1", 34); got != `Jl.~50\%~\&~\#1` {
		t.Errorf("special characters must be escaped: %q", got)
	}
}

// A long delivery place wraps.
// The terms block holds a full office address on clean lines.
func TestLatexExports_LongDeliveryPlaceWraps(t *testing.T) {
	data := quotationData(sampleItems(2))
	data["DeliveryPlace"] = LatexAddress(partyAddress+", Gudang Belakang Blok C Nomor 12", PartyKeep)
	log := compileLog(t, "quotation/Quotation.tex.tmpl", data)
	if !producedOutput(log) {
		t.Skip("xelatex produced no output")
	}
	if over, under, warn := badBoxes(log); over != 0 || under != 0 || warn != 0 {
		t.Errorf("overfull=%d underfull=%d warnings=%d, want all 0", over, under, warn)
	}
}
