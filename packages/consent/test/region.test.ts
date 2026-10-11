import { describe, expect, it } from "vitest"
import {
  classifyRegion,
  DEFAULT_REGIME_TABLE,
  EEA_COUNTRIES,
  normalizeCountry,
  normalizeSubdivision,
  optInRegionCodes,
  type RegimeTable,
  requiresOptIn,
  US_GPC_REQUIRED_STATES,
  US_PRIVACY_STATES,
} from "../src/region.ts"

describe("normalizeCountry", () => {
  it("uppercases and trims", () => {
    expect(normalizeCountry(" de ")).toBe("DE")
  })
  it.each(["XX", "T1", "zz", "EU", "AP", "A1", "", "DEU", "1A", "D", null, undefined])(
    "rejects %s",
    (v) => {
      expect(normalizeCountry(v)).toBeUndefined()
    },
  )
})

describe("normalizeSubdivision", () => {
  it("accepts short and prefixed forms", () => {
    expect(normalizeSubdivision("US", "ca")).toBe("US-CA")
    expect(normalizeSubdivision("US", "us-ca")).toBe("US-CA")
  })
  it("rejects a mismatched prefix, missing country and junk", () => {
    expect(normalizeSubdivision("US", "CA-QC")).toBeUndefined()
    expect(normalizeSubdivision(undefined, "CA")).toBeUndefined()
    expect(normalizeSubdivision("US", "california")).toBeUndefined()
    expect(normalizeSubdivision("US", null)).toBeUndefined()
  })
})

describe("classifyRegion", () => {
  it("maps every EEA country to GDPR opt-in", () => {
    for (const c of EEA_COUNTRIES) {
      const r = classifyRegion({ country: c })
      expect(r.regime.id).toBe("gdpr")
      expect(r.model).toBe("opt-in")
    }
  })

  it("covers EU outermost regions, UK, Gibraltar and Switzerland", () => {
    expect(classifyRegion({ country: "RE" }).regime.id).toBe("gdpr")
    expect(classifyRegion({ country: "gb" }).regime.id).toBe("uk_gdpr")
    expect(classifyRegion({ country: "GI" }).regime.id).toBe("uk_gdpr")
    expect(classifyRegion({ country: "CH" }).model).toBe("opt-in")
  })

  it("classifies LGPD and PIPEDA as opt-out, with Quebec overridden to opt-in", () => {
    expect(classifyRegion({ country: "BR" })).toMatchObject({ model: "opt-out" })
    expect(classifyRegion({ country: "BR" }).regime.id).toBe("lgpd")
    expect(classifyRegion({ country: "CA", subdivision: "ON" }).model).toBe("opt-out")
    const qc = classifyRegion({ country: "CA", subdivision: "QC" })
    expect(qc.regime.id).toBe("pipeda")
    expect(qc.model).toBe("opt-in")
    expect(qc.subdivision).toBe("CA-QC")
  })

  it("applies US state law per state and flags GPC states", () => {
    const ca = classifyRegion({ country: "US", subdivision: "CA" })
    expect(ca.regime.id).toBe("us_state")
    expect(ca.gpcRequired).toBe(true)
    const tx = classifyRegion({ country: "US", subdivision: "TX" })
    expect(tx.regime.id).toBe("us_state")
    const ny = classifyRegion({ country: "US", subdivision: "NY" })
    expect(ny.regime.id).toBe("default")
    expect(ny.gpcRequired).toBe(false)
    expect(classifyRegion({ country: "US" }).regime.id).toBe("default")
  })

  it("keeps the GPC list a subset of the privacy-state list", () => {
    for (const s of US_GPC_REQUIRED_STATES) expect(US_PRIVACY_STATES).toContain(s)
  })

  it("fails open to the default regime for unknown countries", () => {
    const r = classifyRegion({ country: "XX" })
    expect(r.regime.id).toBe("default")
    expect(r.model).toBe("opt-out")
    expect(r.country).toBeUndefined()
    expect(classifyRegion({}).regime.id).toBe("default")
  })

  it("lets the caller choose the model for an unknown country", () => {
    expect(classifyRegion({ country: "T1" }, { unknown: "opt-in" }).model).toBe("opt-in")
    // A known country ignores the unknown option.
    expect(classifyRegion({ country: "JP" }, { unknown: "opt-in" }).model).toBe("opt-out")
  })

  it("ignores a subdivision from another country", () => {
    const r = classifyRegion({ country: "US", subdivision: "CA-QC" })
    expect(r.subdivision).toBeUndefined()
    expect(r.model).toBe("opt-out")
  })

  it("accepts a custom table", () => {
    const table: RegimeTable = {
      ...DEFAULT_REGIME_TABLE,
      countries: { ...DEFAULT_REGIME_TABLE.countries, BR: "gdpr" },
    }
    expect(requiresOptIn({ country: "BR" }, { table })).toBe(true)
    expect(requiresOptIn({ country: "BR" })).toBe(false)
  })
})

describe("optInRegionCodes", () => {
  it("lists opt-in countries and overrides, sorted and unique", () => {
    const codes = optInRegionCodes()
    expect(codes).toContain("DE")
    expect(codes).toContain("GB")
    expect(codes).toContain("CH")
    expect(codes).toContain("CA-QC")
    expect(codes).not.toContain("US")
    expect(codes).not.toContain("BR")
    expect([...codes].sort()).toEqual(codes)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
