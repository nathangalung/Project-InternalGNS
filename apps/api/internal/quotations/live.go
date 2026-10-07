package quotations

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// EditLockTTL is a claim's lifetime.
// An editor renews it while the part is open; a closed tab or a lost
// connection frees the part this long after the last renewal.
const EditLockTTL = 2 * time.Minute

// HeaderPart is the header's part name.
const HeaderPart = "header"

// LinePart names one line's part.
func LinePart(lineID int64) string {
	return "line:" + strconv.FormatInt(lineID, 10)
}

// Lock claims or renews a part.
func (r *Repo) Lock(ctx context.Context, id int64, part string, userID int64) (time.Time, error) {
	var until time.Time
	err := r.db.QueryRow(ctx, r.store.Get("quotations.lock"),
		id, part, userID, int(EditLockTTL/time.Second)).Scan(&until)
	return until, err
}

// Unlock frees the caller's own claim.
func (r *Repo) Unlock(ctx context.Context, id int64, part string, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("quotations.unlock"), id, part, userID)
	return err
}

// EditLocks lists unexpired claims.
func (r *Repo) EditLocks(ctx context.Context, id int64) ([]EditLock, error) {
	rows, err := r.db.Query(ctx, r.store.Get("quotations.edit_locks"), id)
	if err != nil {
		return nil, fmt.Errorf("edit locks: %w", err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[EditLock])
}

// AddLines appends product lines.
func (r *Repo) AddLines(ctx context.Context, id int64, items []CreateItem, userID int64) ([]int64, error) {
	raw, err := itemsToJSONB(items)
	if err != nil {
		return nil, err
	}
	var ids []int64
	err = r.db.QueryRow(ctx, r.store.Get("quotations.add_lines"), id, raw, userID).Scan(&ids)
	return ids, err
}

// UpdateLine saves one claimed line.
func (r *Repo) UpdateLine(ctx context.Context, id, lineID int64, item CreateItem, userID int64) error {
	raw, err := json.Marshal(dbItem(item))
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx, r.store.Get("quotations.update_line"), id, lineID, raw, userID)
	return err
}

// SetLineOffer marks a line offered or not.
func (r *Repo) SetLineOffer(ctx context.Context, id, lineID int64, available bool, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("quotations.set_line_offer"), id, lineID, available, userID)
	return err
}

// DeleteLine removes one line.
func (r *Repo) DeleteLine(ctx context.Context, id, lineID, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("quotations.delete_line"), id, lineID, userID)
	return err
}

// UpdateHeader saves the claimed header.
func (r *Repo) UpdateHeader(ctx context.Context, id int64, req HeaderRequest, userID int64) error {
	_, err := r.db.Exec(ctx, r.store.Get("quotations.update_header"),
		id, req.ClientRefNo, req.VesselName, req.PaymentTerms, req.ValidityDays,
		req.DiscountPct, req.ShippingAddress, req.ShippingDays, req.ShippingCost,
		req.Notes, userID, req.PPNEnabled)
	return err
}

// rowVersion reads the version.
// pgx.ErrNoRows means no such quotation.
func (r *Repo) rowVersion(ctx context.Context, id int64) (int32, error) {
	var v int32
	err := r.db.QueryRow(ctx, r.store.Get("quotations.row_version"), id).Scan(&v)
	return v, err
}
