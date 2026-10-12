/**
 * IndexNow (https://www.indexnow.org/documentation): tell participating search
 * engines (Bing, Yandex, Seznam, Naver, ...) which URLs changed. These are pure
 * builders: you POST the payloads yourself.
 *
 * - A key is 8-128 characters of `[A-Za-z0-9-]`, hosted as a text file whose
 *   body is the key (default location `https://<host>/<key>.txt`).
 * - One request carries at most 10,000 URLs, all on the key's host.
 * - Submit only URLs that actually changed; {@link diffIndexNowManifest} keeps a
 *   revision manifest so repeated deploys do not resubmit everything.
 */

import { sha256 } from "@bib/shared/hashing"

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"
export const INDEXNOW_MAX_URLS = 10_000

const KEY = /^[A-Za-z0-9-]{8,128}$/

/** True when `key` satisfies the IndexNow key format. */
export function isValidIndexNowKey(key: string): boolean {
  return KEY.test(key)
}

/** The key file to host: `{ path: "/<key>.txt", body: "<key>" }`. Throws on an invalid key. */
export function indexNowKeyFile(key: string): {
  readonly path: string
  readonly body: string
  readonly contentType: string
} {
  if (!isValidIndexNowKey(key))
    throw new RangeError("IndexNow key must be 8-128 characters of [A-Za-z0-9-]")
  return { path: `/${key}.txt`, body: key, contentType: "text/plain; charset=utf-8" }
}

export interface IndexNowPayload {
  readonly host: string
  readonly key: string
  readonly keyLocation?: string
  readonly urlList: readonly string[]
}

export interface IndexNowRejection {
  readonly url: string
  readonly reason: "invalid-url" | "not-https" | "wrong-host" | "has-credentials" | "duplicate"
}

export interface IndexNowBatches {
  /** POST each one as JSON to {@link INDEXNOW_ENDPOINT}. Empty when no URL survived. */
  readonly payloads: readonly IndexNowPayload[]
  readonly rejected: readonly IndexNowRejection[]
}

export interface IndexNowInput {
  /** Bare host, e.g. `www.example.com` (no scheme, no path). */
  readonly host: string
  readonly key: string
  /** Absolute URL of the key file, on `host`. Omit when it is at `/<key>.txt`. */
  readonly keyLocation?: string
  readonly urls: readonly string[]
  /** Allow `http:` URLs (default false; IndexNow accepts them but https is expected). */
  readonly allowHttp?: boolean
}

/**
 * Validate URLs and split them into payloads of at most 10,000. URLs on another
 * host, with credentials, or unparseable are returned in `rejected` rather than
 * thrown, so one bad URL does not block a deploy. Fragments are stripped and
 * duplicates removed.
 */
export function buildIndexNowPayloads(input: IndexNowInput): IndexNowBatches {
  const host = input.host.trim().toLowerCase()
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host) || host === "") {
    throw new RangeError(`host must be a bare host name, got "${input.host}"`)
  }
  if (!isValidIndexNowKey(input.key))
    throw new RangeError("IndexNow key must be 8-128 characters of [A-Za-z0-9-]")
  if (input.keyLocation !== undefined) {
    let loc: URL
    try {
      loc = new URL(input.keyLocation)
    } catch {
      throw new RangeError(`keyLocation must be an absolute URL, got ${input.keyLocation}`)
    }
    if (loc.host.toLowerCase() !== host)
      throw new RangeError("keyLocation must be on the same host")
  }
  const accepted: string[] = []
  const seen = new Set<string>()
  const rejected: IndexNowRejection[] = []
  for (const raw of input.urls) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      rejected.push({ url: raw, reason: "invalid-url" })
      continue
    }
    if (url.protocol !== "https:" && !(input.allowHttp && url.protocol === "http:")) {
      rejected.push({ url: raw, reason: "not-https" })
      continue
    }
    if (url.username || url.password) {
      rejected.push({ url: raw, reason: "has-credentials" })
      continue
    }
    if (url.host.toLowerCase() !== host) {
      rejected.push({ url: raw, reason: "wrong-host" })
      continue
    }
    url.hash = ""
    const text = url.toString()
    if (seen.has(text)) {
      rejected.push({ url: raw, reason: "duplicate" })
      continue
    }
    seen.add(text)
    accepted.push(text)
  }
  const payloads: IndexNowPayload[] = []
  for (let i = 0; i < accepted.length; i += INDEXNOW_MAX_URLS) {
    const urlList = accepted.slice(i, i + INDEXNOW_MAX_URLS)
    payloads.push(
      input.keyLocation === undefined
        ? { host, key: input.key, urlList }
        : { host, key: input.key, keyLocation: input.keyLocation, urlList },
    )
  }
  return { payloads, rejected }
}

/** Map of URL to revision fingerprint, as stored between deploys. */
export type IndexNowManifest = Readonly<Record<string, string>>

export interface IndexNowDiff {
  readonly manifest: IndexNowManifest
  readonly added: readonly string[]
  readonly updated: readonly string[]
  readonly removed: readonly string[]
  readonly unchanged: readonly string[]
  /** `added + updated + removed`: what to submit (removed URLs should now return 404/410). */
  readonly toSubmit: readonly string[]
}

/**
 * Fingerprint of one URL at one revision. `revision` is whatever identifies
 * the content: a content hash, an `updatedAt` timestamp, a version number.
 */
export function indexNowFingerprint(url: string, revision: string): Promise<string> {
  return sha256(`indexnow-url-v1\u0000${url}\u0000${revision}`)
}

/**
 * Compare current `url -> revision` pairs against the previous manifest. A URL
 * is `updated` only when its fingerprint changed, so redeploying unchanged
 * content submits nothing.
 */
export async function diffIndexNowManifest(
  previous: IndexNowManifest,
  current: Readonly<Record<string, string>>,
): Promise<IndexNowDiff> {
  const manifest: Record<string, string> = {}
  const added: string[] = []
  const updated: string[] = []
  const unchanged: string[] = []
  for (const url of Object.keys(current).sort()) {
    const revision = current[url] as string
    const fingerprint = await indexNowFingerprint(url, revision)
    manifest[url] = fingerprint
    const prior = previous[url]
    if (prior === undefined) added.push(url)
    else if (prior !== fingerprint) updated.push(url)
    else unchanged.push(url)
  }
  const removed = Object.keys(previous)
    .filter((url) => !(url in current))
    .sort()
  return {
    manifest,
    added,
    updated,
    removed,
    unchanged,
    toSubmit: [...added, ...updated, ...removed],
  }
}
