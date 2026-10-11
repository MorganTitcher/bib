import { describe, expect, it } from "vitest"
import {
  EnvError,
  getEnv,
  parseEnvBoolean,
  parseEnvEnum,
  parseEnvInt,
  requireEnv,
} from "../src/env.ts"

const source = {
  NAME: "  svc  ",
  BLANK: "   ",
  FLAG_ON: "Yes",
  FLAG_OFF: "0",
  FLAG_BAD: "maybe",
  PORT: "8080",
  NEG: "-3",
  JUNK: "12abc",
  HEX: "0x10",
  FLOAT: "1.5",
  HUGE: "9007199254740993",
  MODE: "prod",
  SECRET: "hunter2",
}

describe("getEnv / requireEnv", () => {
  it("trims and treats blank as unset", () => {
    expect(getEnv("NAME", undefined, source)).toBe("svc")
    expect(getEnv("BLANK", "dflt", source)).toBe("dflt")
    expect(getEnv("MISSING", undefined, source)).toBeUndefined()
  })
  it("requires values", () => {
    expect(requireEnv("NAME", source)).toBe("svc")
    expect(() => requireEnv("BLANK", source)).toThrow("BLANK: is required but not set")
    expect(() => requireEnv("MISSING", source)).toThrow(EnvError)
  })
  it("reads process.env by default", () => {
    process.env.BIB_SHARED_TEST_VAR = "from-process"
    try {
      expect(getEnv("BIB_SHARED_TEST_VAR")).toBe("from-process")
    } finally {
      delete process.env.BIB_SHARED_TEST_VAR
    }
  })
})

describe("parseEnvBoolean", () => {
  it("accepts common spellings", () => {
    expect(parseEnvBoolean("FLAG_ON", { source })).toBe(true)
    expect(parseEnvBoolean("FLAG_OFF", { source })).toBe(false)
    expect(parseEnvBoolean("MISSING", { source, default: true })).toBe(true)
  })
  it("rejects anything else", () => {
    expect(() => parseEnvBoolean("FLAG_BAD", { source })).toThrow(EnvError)
    expect(() => parseEnvBoolean("MISSING", { source })).toThrow("is required")
  })
})

describe("parseEnvInt", () => {
  it("parses base-10 integers within bounds", () => {
    expect(parseEnvInt("PORT", { source, min: 1, max: 65535 })).toBe(8080)
    expect(parseEnvInt("NEG", { source })).toBe(-3)
    expect(parseEnvInt("MISSING", { source, default: 3000 })).toBe(3000)
  })
  it("rejects malformed and out-of-range values", () => {
    expect(() => parseEnvInt("JUNK", { source })).toThrow("must be an integer")
    expect(() => parseEnvInt("HEX", { source })).toThrow(EnvError)
    expect(() => parseEnvInt("FLOAT", { source })).toThrow(EnvError)
    expect(() => parseEnvInt("HUGE", { source })).toThrow("safe integer")
    expect(() => parseEnvInt("PORT", { source, max: 1024 })).toThrow("must be <= 1024")
    expect(() => parseEnvInt("NEG", { source, min: 0 })).toThrow("must be >= 0")
  })
})

describe("parseEnvEnum", () => {
  it("accepts allowed values case-sensitively", () => {
    expect(parseEnvEnum("MODE", ["dev", "prod"], { source })).toBe("prod")
    expect(parseEnvEnum("MISSING", ["dev", "prod"], { source, default: "dev" })).toBe("dev")
    expect(() => parseEnvEnum("MODE", ["DEV", "PROD"], { source })).toThrow(
      "must be one of: DEV, PROD",
    )
  })
})

describe("errors never echo values", () => {
  it("omits the raw value", () => {
    try {
      parseEnvInt("SECRET", { source })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError)
      expect(String(error)).not.toContain("hunter2")
      if (error instanceof EnvError) expect(error.variable).toBe("SECRET")
    }
  })
})
