import { describe, expect, it } from "vitest"
import * as sla from "../src/index.ts"

describe("barrel", () => {
  it("re-exports every module", () => {
    for (const name of [
      "wallTimeToInstant",
      "resolveHolidays",
      "US_FEDERAL_HOLIDAYS",
      "UK_ENGLAND_WALES_BANK_HOLIDAYS",
      "defineSchedule",
      "addBusinessTime",
      "startTimer",
      "evaluate",
    ]) {
      expect(sla).toHaveProperty(name)
    }
  })
})
