// Package sheet writes single-sheet XLSX.
// The sheet is built from headers and string rows.
package sheet

import (
	"bytes"
	"fmt"
	"io"

	"github.com/xuri/excelize/v2"
)

// Write builds the XLSX bytes.
// A bold header row comes first, then one row per record.
func Write(sheetName string, headers []string, rows [][]string) ([]byte, error) {
	var buf bytes.Buffer
	if err := write(&buf, sheetName, headers, rows); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// write streams the workbook out.
func write(w io.Writer, sheetName string, headers []string, rows [][]string) error {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	if sheetName == "" {
		sheetName = "Sheet1"
	}
	idx, err := f.NewSheet(sheetName)
	if err != nil {
		return err
	}
	f.SetActiveSheet(idx)
	if sheetName != "Sheet1" {
		_ = f.DeleteSheet("Sheet1")
	}

	bold, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return err
	}

	for c, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(c+1, 1)
		_ = f.SetCellStr(sheetName, cell, h)
		_ = f.SetCellStyle(sheetName, cell, cell, bold)
	}
	for r, row := range rows {
		for c, val := range row {
			cell, _ := excelize.CoordinatesToCellName(c+1, r+2)
			_ = f.SetCellStr(sheetName, cell, val)
		}
	}

	if err := f.Write(w); err != nil {
		return fmt.Errorf("write xlsx: %w", err)
	}
	return nil
}
