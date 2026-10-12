/**
 * Split an invoice three ways, collect the results, and export them as CSV.
 *
 * Run after building:
 *
 *   pnpm --filter @bib/shared build
 *   node packages/shared/examples/split-invoice.ts
 *
 * Expected output (five lines):
 *
 *   payer,amount
 *   alice,33.34
 *   bob,33.33
 *   carol,33.33
 *   rejected: share for dave is negative
 *
 * CSV rows are CRLF-separated per RFC 4180; the example prints them with
 * plain newlines. `allocate` hands the leftover cent to the first share, so the parts always
 * sum back to the total. `collect` turns a list of results into one result and
 * stops at the first error.
 */

import { toCsv } from "../dist/csv.js"
import { allocate, fromMajor, type Money, toMajorString } from "../dist/money.js"
import { collect, err, ok, type Result } from "../dist/result.js"

const payers = ["alice", "bob", "carol"]
const shares = allocate(fromMajor("100.00", "USD"), [1, 1, 1])

function checkShare(payer: string, share: Money): Result<string[], string> {
  return share.amount < 0n
    ? err(`share for ${payer} is negative`)
    : ok([payer, toMajorString(share)])
}

const rows = collect(
  payers.map((payer, index) => checkShare(payer, shares[index] ?? fromMajor("0", "USD"))),
)
if (rows.ok) {
  console.log(toCsv(["payer", "amount"], rows.value).replaceAll("\r\n", "\n"))
}

const bad = collect([checkShare("dave", fromMajor("-1.00", "USD"))])
if (!bad.ok) {
  console.log(`rejected: ${bad.error}`)
}
