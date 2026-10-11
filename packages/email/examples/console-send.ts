/**
 * Send through the console provider wrapped in retry and idempotency.
 *
 * Run after building:
 *
 *   pnpm --filter @bib/email build
 *   node packages/email/examples/console-send.ts
 *
 * Expected output (four lines):
 *
 *   {"provider":"console","messageId":"console-1","idempotencyKey":"receipt:order-1001","message":{"from":"r***@example.com","to":["a***@example.com"],"cc":[],"bcc":[],"replyTo":[],"subject":"Your receipt","htmlLength":29,"textLength":22,"attachments":[],"tags":[{"name":"category","value":"receipt"}],"headers":{},"metadata":{}}}
 *   sent console-1 deduplicated=false
 *   sent console-1 deduplicated=true
 *   rejected email_validation: to: address has no domain
 *
 * The first line is the console provider's redacted log: addresses are masked
 * and the bodies are replaced by their lengths. The second send reuses the key,
 * so the idempotency store returns the stored result without logging again.
 */

import {
  createConsoleProvider,
  createEmailClient,
  createMemoryIdempotencyStore,
  withIdempotency,
  withRetry,
} from "../dist/index.js"

const console_ = createConsoleProvider({ now: () => new Date("2026-10-11T00:00:00Z") })
const provider = withIdempotency(withRetry(console_), { store: createMemoryIdempotencyStore() })
const client = createEmailClient({ provider, defaultFrom: "Receipts <receipts@example.com>" })

const receipt = {
  to: "ada@example.com",
  subject: "Your receipt",
  html: "<p>Thanks for order 1001.</p>",
  text: "Thanks for order 1001.",
  tags: [{ name: "category", value: "receipt" }],
}

for (let attempt = 0; attempt < 2; attempt++) {
  const outcome = await client.send(receipt, { idempotencyKey: "receipt:order-1001" })
  if (outcome.ok) {
    console.log(
      `sent ${outcome.value.messageId} deduplicated=${outcome.value.deduplicated === true}`,
    )
  }
}

const bad = await client.send({ ...receipt, to: "ada@" })
if (!bad.ok) {
  const issues = (bad.error.details?.issues ?? []) as { path: string; message: string }[]
  console.log(
    `rejected ${bad.error.code}: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
  )
}
