package db

// SQLSTATE codes the API handles.
// The P00xx codes are raised by our own plpgsql functions with USING ERRCODE;
// each value must match the ERRCODE in db/functions, which is why they are
// named once here instead of repeated as literals in repos and httperr.
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const (
	// SQLStateRaiseException: RAISE without ERRCODE.
	SQLStateRaiseException = "P0001"
	// SQLStateVersionMismatch: stale If-Match version.
	SQLStateVersionMismatch = "P0010"
	// SQLStateNotFound: missing target row.
	SQLStateNotFound = "P0011"
	// SQLStateInvalidTransition: refused status change.
	SQLStateInvalidTransition = "P0012"
	// SQLStateBlockedByRelated: related record forbids.
	SQLStateBlockedByRelated = "P0013"
	// SQLStateValidation: rejected function input.
	SQLStateValidation = "P0014"
	// SQLStateUnpricedLine: finalising unpriced products.
	SQLStateUnpricedLine = "P0100"

	SQLStateUniqueViolation           = "23505"
	SQLStateForeignKeyViolation       = "23503"
	SQLStateNotNullViolation          = "23502"
	SQLStateCheckViolation            = "23514"
	SQLStateInvalidTextRepresentation = "22P02"
	SQLStateNumericOutOfRange         = "22003"

	// Unstorable input data exceptions.
	SQLStateStringDataRightTruncation = "22001"
	SQLStateInvalidDatetimeFormat     = "22007"
	SQLStateDatetimeFieldOverflow     = "22008"
	SQLStateCharacterNotInRepertoire  = "22021"
)
