import { describe, expect, it } from "vitest"
import * as consent from "../src/index.ts"

describe("barrel", () => {
  it("re-exports every module's runtime API", () => {
    for (const name of [
      "classifyRegion",
      "createConsentState",
      "parseConsent",
      "buildDefaultCommands",
      "toConsentMode",
      "parseUtm",
      "extractClickIds",
      "classifyReferrer",
      "buildTouch",
      "recordTouch",
      "stripTrackingParams",
    ]) {
      expect(typeof (consent as Record<string, unknown>)[name]).toBe("function")
    }
  })
})
