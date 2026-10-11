import { describe, it } from "vitest"
import { createPostmarkProvider } from "../src/providers/postmark.ts"
import { createResendProvider } from "../src/providers/resend.ts"
import { createSendGridProvider } from "../src/providers/sendgrid.ts"
import { createSesProvider } from "../src/providers/ses.ts"
import { runProviderContract } from "../src/testing.ts"

const runner = { describe, it }

runProviderContract(runner, {
  name: "resend",
  secret: "re_contract_secret",
  makeProvider: (fetch) => createResendProvider({ apiKey: "re_contract_secret", fetch }),
  success: () => ({ status: 200, body: { id: "msg_1" } }),
})

runProviderContract(runner, {
  name: "postmark",
  secret: "pm-contract-secret",
  makeProvider: (fetch) => createPostmarkProvider({ serverToken: "pm-contract-secret", fetch }),
  success: () => ({ status: 200, body: { MessageID: "pm-1", ErrorCode: 0, Message: "OK" } }),
})

runProviderContract(runner, {
  name: "sendgrid",
  secret: "SG.contract-secret",
  makeProvider: (fetch) => createSendGridProvider({ apiKey: "SG.contract-secret", fetch }),
  success: () => ({ status: 202, body: "", headers: { "x-message-id": "sg-1" } }),
})

runProviderContract(runner, {
  name: "ses",
  secret: "ses-contract-secret-key",
  makeProvider: (fetch) =>
    createSesProvider({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIDCONTRACT", secretAccessKey: "ses-contract-secret-key" },
      fetch,
      now: () => new Date("2026-10-11T00:00:00Z"),
    }),
  success: () => ({ status: 200, body: { MessageId: "ses-1" } }),
})
