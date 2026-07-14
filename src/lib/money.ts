// Money in this app is entered and stored as pesos, and almost everything the
// operator types is a whole number. The one place a fractional value arises is
// splitting a utility overage across an apartment's occupants
// (excess / headcount), which produces repeating decimals like ₱333.3333 —
// values that render badly and, when summed across many months, drift by
// sub-centavo amounts so receipts and statements never reconcile.
//
// Rounding to whole centavos (2 decimal places) at the point of division keeps
// every charge a clean, payable amount and stops that drift from accumulating.
// Peso is the smallest unit a tenant is billed above the centavo, so 2 decimals
// is the correct precision for currency here.

// Round a peso amount to whole centavos. The `+ Number.EPSILON` nudge corrects
// for binary floating-point representation error, so a value that is
// mathematically x.xx5 rounds up as a human expects (e.g. 1.005 -> 1.01, not
// the 1.00 you get from a naive Math.round(1.005 * 100)).
export function roundCentavos(pesos: number): number {
  return Math.round((pesos + Number.EPSILON) * 100) / 100
}
