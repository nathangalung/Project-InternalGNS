// Package sheet writes a single-sheet XLSX from headers + string rows.
package sheet

import (
	"bytes"
	"fmt"

	"github.com/xuri/excelize/v2"
)

// Write returns XLSX bytes: bold header row, then one row per record.
func Write(sheetName string, headers []string, rows [][]string) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	if sheetName == "" {
		sheetName = "Sheet1"
	}
	idx, err := f.NewSheet(sheetName)
	if err != nil {
		return nil, err
	}
	f.SetActiveSheet(idx)
	if sheetName != "Sheet1" {
		_ = f.DeleteSheet("Sheet1")
	}

	bold, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
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

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, fmt.Errorf("write xlsx: %w", err)
	}
	return buf.Bytes(), nil
}
