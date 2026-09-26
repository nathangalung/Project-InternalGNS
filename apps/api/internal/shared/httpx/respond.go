package httpx

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// JSON response with status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteXLSX sends an XLSX attachment.
// filename is the base name without extension.
func WriteXLSX(w http.ResponseWriter, filename string, data []byte) {
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.xlsx"`, filename))
	_, _ = w.Write(data)
}

// WriteList writes rows with X-Total-Count.
// total is the size of the whole set, which is len(rows) for an unpaged list.
func WriteList(w http.ResponseWriter, total int64, rows any) {
	w.Header().Set("X-Total-Count", strconv.FormatInt(total, 10))
	WriteJSON(w, http.StatusOK, rows)
}
