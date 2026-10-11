// Explicit named re-exports. `@bib/email/testing` is intentionally a subpath only.

export {
  type Address,
  type AddressInput,
  addressProblem,
  encodeHeaderWord,
  type FormatAddressOptions,
  formatAddress,
  isValidEmail,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_LOCAL_PART_LENGTH,
  normalizeEmail,
  parseAddress,
  parseAddressList,
} from "./address.ts"
export {
  createEmailClient,
  type EmailClient,
  type EmailClientOptions,
} from "./client.ts"
export {
  classifyHttpStatus,
  EMAIL_ERROR_KINDS,
  EmailError,
  type EmailErrorKind,
  type EmailErrorOptions,
  isAmbiguousKind,
  isEmailError,
  isRetryableKind,
} from "./errors.ts"
export {
  createFallbackProvider,
  defaultShouldFallback,
  type FallbackOptions,
  intersectCapabilities,
} from "./fallback.ts"
export {
  countsAgainstHealth,
  type HealthOptions,
  type HealthTrackedProvider,
  type ProviderHealth,
  withHealth,
} from "./health.ts"
export {
  DEFAULT_TIMEOUT_MS,
  errorFromResponse,
  type HttpRequest,
  type HttpResponse,
  jsonNumber,
  jsonString,
  MAX_ERROR_TEXT,
  postJson,
  type ResponseErrorOptions,
  scrubSecrets,
  sendRequest,
} from "./http.ts"
export {
  type BeginOutcome,
  createMemoryIdempotencyStore,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_PENDING_TTL_MS,
  type IdempotencyOptions,
  type IdempotencyStore,
  idempotencyKeyFor,
  type MemoryIdempotencyStore,
  type MemoryIdempotencyStoreOptions,
  messageFingerprint,
  withIdempotency,
} from "./idempotency.ts"
export {
  type Attachment,
  type AttachmentInput,
  allRecipients,
  attachmentBytes,
  base64DecodedLength,
  bytesToBase64,
  type EmailMessage,
  type EmailMessageInput,
  EmailMessageInputSchema,
  guessContentType,
  MAX_HEADER_VALUE_LENGTH,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_METADATA_ENTRIES,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_VALUE_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  parseMessage,
  RESERVED_HEADERS,
  type Tag,
} from "./message.ts"
export {
  checkCapabilities,
  type EmailProvider,
  effectiveIdempotencyKey,
  type FetchLike,
  type ProviderCapabilities,
  type SendOptions,
  type SendOutcome,
  type SendResult,
  sendResult,
} from "./provider.ts"
export {
  CONSOLE_CAPABILITIES,
  type ConsoleProviderOptions,
  createConsoleProvider,
} from "./providers/console.ts"
export {
  createMemoryProvider,
  type MemoryProvider,
  type MemoryProviderOptions,
  type SentEmail,
} from "./providers/memory.ts"
export {
  createPostmarkProvider,
  POSTMARK_CAPABILITIES,
  type PostmarkOptions,
  toPostmarkPayload,
} from "./providers/postmark.ts"
export {
  createResendProvider,
  RESEND_CAPABILITIES,
  type ResendOptions,
  toResendPayload,
} from "./providers/resend.ts"
export {
  createSendGridProvider,
  SENDGRID_CAPABILITIES,
  SENDGRID_MAX_CATEGORIES,
  type SendGridOptions,
  toSendGridPayload,
} from "./providers/sendgrid.ts"
export {
  createSesProvider,
  SES_CAPABILITIES,
  type SesOptions,
  sesErrorType,
  toSesPayload,
} from "./providers/ses.ts"
export {
  type AwsCredentials,
  amzDate,
  computeSignature,
  deriveSigningKey,
  type SignableRequest,
  type SignatureParts,
  signRequest,
  uriEncode,
} from "./providers/sigv4.ts"
export {
  createSmtpProvider,
  SMTP_CAPABILITIES,
  type SmtpOptions,
} from "./providers/smtp.ts"
export {
  isSensitiveName,
  maskEmail,
  REDACTED,
  type RedactedMessage,
  type RedactOptions,
  redactMessage,
  redactSecrets,
} from "./redact.ts"
export {
  type EmailRetryEvent,
  type EmailRetryOptions,
  isRetryableFor,
  type RetryAmbiguousPolicy,
  withRetry,
} from "./retry.ts"
