package sheet

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

// Workbook reads back intact.
// The header row is bold, the records follow in order, and a blank name
// falls back to Sheet1 instead of leaving an unnamed tab.
func TestWrite(t *testing.T) {
	cases := []struct {
		name      string
		sheet     string
		wantSheet string
	}{
		{"named sheet", "Faktur", "Faktur"},
		{"blank name", "", "Sheet1"},
		{"explicit Sheet1", "Sheet1", "Sheet1"},
	}
	headers := []string{"No", "Klien", "Total"}
	rows := [][]string{{"1", "PT Laut", "1.000"}, {"2", "CV Samudra", "2.500"}}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw, err := Write(c.sheet, headers, rows)
			require.NoError(t, err)

			f, err := excelize.OpenReader(bytes.NewReader(raw))
			require.NoError(t, err)
			t.Cleanup(func() { _ = f.Close() })
			assert.Equal(t, []string{c.wantSheet}, f.GetSheetList(), "exactly one sheet")

			got, err := f.GetRows(c.wantSheet)
			require.NoError(t, err)
			assert.Equal(t, append([][]string{headers}, rows...), got)

			for _, cell := range []string{"A1", "C1"} {
				styleID, err := f.GetCellStyle(c.wantSheet, cell)
				require.NoError(t, err)
				style, err := f.GetStyle(styleID)
				require.NoError(t, err)
				require.NotNil(t, style.Font, cell)
				assert.True(t, style.Font.Bold, "%s must be bold", cell)
			}
			styleID, err := f.GetCellStyle(c.wantSheet, "A2")
			require.NoError(t, err)
			style, err := f.GetStyle(styleID)
			require.NoError(t, err)
			assert.False(t, style.Font != nil && style.Font.Bold, "records are not bold")
		})
	}
}

// Text stays text.
// Leading zeros and formula-looking values must survive as typed strings.
func TestWrite_KeepsCellsAsText(t *testing.T) {
	raw, err := Write("Data", []string{"NPWP", "Catatan"}, [][]string{{"0012345678901234", "=SUM(A1:A2)"}})
	require.NoError(t, err)
	f, err := excelize.OpenReader(bytes.NewReader(raw))
	require.NoError(t, err)
	t.Cleanup(func() { _ = f.Close() })

	npwp, err := f.GetCellValue("Data", "A2")
	require.NoError(t, err)
	assert.Equal(t, "0012345678901234", npwp)
	formula, err := f.GetCellFormula("Data", "B2")
	require.NoError(t, err)
	assert.Empty(t, formula, "a value must not become a formula")
}

// Invalid sheet name errors.
func TestWrite_InvalidSheetName(t *testing.T) {
	_, err := Write(strings.Repeat("x", 32), []string{"a"}, nil)
	require.Error(t, err)
	_, err = Write("a:b", []string{"a"}, nil)
	require.Error(t, err)
}

var errSink = errors.New("disk full")

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errSink }

// Sink failure surfaces wrapped.
// A writer that refuses the bytes must fail the export, not return a
// truncated workbook.
func TestWrite_SinkFailure(t *testing.T) {
	err := write(failingWriter{}, "Data", []string{"a"}, [][]string{{"1"}})
	require.ErrorIs(t, err, errSink)
	assert.Contains(t, err.Error(), "write xlsx")
}

// Money columns are numbers.
// Excel sums and sorts them only as numbers; a blank or unparsable value
// stays as it is, and the other columns stay text.
func TestWrite_MoneyColumnsAreNumbers(t *testing.T) {
	rows := [][]string{{"Q-1", "1234567.89"}, {"Q-2", ""}, {"Q-3", "n/a"}}
	raw, err := Write("Data", []string{"No", "Total"}, rows, 1)
	require.NoError(t, err)
	f, err := excelize.OpenReader(bytes.NewReader(raw))
	require.NoError(t, err)
	t.Cleanup(func() { _ = f.Close() })

	// A number cell carries no string type.
	kind, err := f.GetCellType("Data", "B2")
	require.NoError(t, err)
	assert.Contains(t, []excelize.CellType{excelize.CellTypeUnset, excelize.CellTypeNumber}, kind)
	value, err := f.GetCellValue("Data", "B2", excelize.Options{RawCellValue: true})
	require.NoError(t, err)
	assert.Equal(t, "1234567.89", value)
	styleID, err := f.GetCellStyle("Data", "B2")
	require.NoError(t, err)
	style, err := f.GetStyle(styleID)
	require.NoError(t, err)
	require.NotNil(t, style.CustomNumFmt)
	assert.Equal(t, "#,##0.00", *style.CustomNumFmt)

	blank, err := f.GetCellValue("Data", "B3")
	require.NoError(t, err)
	assert.Empty(t, blank)
	text, err := f.GetCellValue("Data", "B4")
	require.NoError(t, err)
	assert.Equal(t, "n/a", text)
	kind, err = f.GetCellType("Data", "A2")
	require.NoError(t, err)
	assert.NotContains(t, []excelize.CellType{excelize.CellTypeUnset, excelize.CellTypeNumber}, kind,
		"other columns stay text")
}
