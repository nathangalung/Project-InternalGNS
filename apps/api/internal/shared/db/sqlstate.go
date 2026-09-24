package db

// SQLSTATE codes the API reacts to.
// The P00xx codes are raised by our own plpgsql functions with USING ERRCODE;
// each value must match the ERRCODE in db/functions, which is why they are
// named once here instead of repeated as literals in repos and httperr.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const (
	// SQLStateRaiseException is a plain RAISE EXCEPTION with no ERRCODE.
	SQLStateRaiseException = "P0001"
	// SQLStateVersionMismatch is a stale If-Match row_version.
	SQLStateVersionMismatch = "P0010"
	// SQLStateNotFound is a missing target row.
	SQLStateNotFound = "P0011"
	// SQLStateInvalidTransition is a status change the machine refuses.
	SQLStateInvalidTransition = "P0012"
	// SQLStateBlockedByRelated is a change a related record's state forbids.
	SQLStateBlockedByRelated = "P0013"
	// SQLStateValidation is an input the function rejects.
	SQLStateValidation = "P0014"
	// SQLStateUnpricedLine is finalising a quotation with an unpriced product.
	SQLStateUnpricedLine = "P0100"

	SQLStateUniqueViolation           = "23505"
	SQLStateForeignKeyViolation       = "23503"
	SQLStateNotNullViolation          = "23502"
	SQLStateCheckViolation            = "23514"
	SQLStateInvalidTextRepresentation = "22P02"
	SQLStateNumericOutOfRange         = "22003"

	// Data exceptions: a value Postgres cannot store as sent.
	SQLStateStringDataRightTruncation = "22001"
	SQLStateInvalidDatetimeFormat     = "22007"
	SQLStateDatetimeFieldOverflow     = "22008"
	SQLStateCharacterNotInRepertoire  = "22021"
)
