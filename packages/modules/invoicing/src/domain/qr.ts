import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'

/**
 * The ZATCA invoice QR code — TLV, then base64. docs/01 NFR-C4
 *
 * The QR a Saudi invoice carries is not a URL: it is a base64 string of
 * concatenated TLV fields — one byte of tag, one byte of length, then the
 * value — that the VAT app on a phone decodes offline. Phase 1 defined five
 * text tags; phase 2 appends BINARY ones (the invoice hash, the ECDSA
 * signature, the public key), which is why values here may be raw bytes and
 * why LENGTH IS BYTES, NOT CHARACTERS — an Arabic seller name is one to four
 * bytes per character in UTF-8, and a QR that counted characters would decode
 * as garbage from the VAT number onward.
 */

export interface QrField {
  /** 1–255, per the TLV envelope's one-byte tag. */
  tag: number
  /** Text is UTF-8 encoded; bytes pass through untouched. */
  value: string | Uint8Array
}

/** Phase 1's five tags, in the order the specification lists them. */
export const QR_TAGS = {
  sellerName: 1,
  sellerVatNumber: 2,
  timestamp: 3,
  invoiceTotal: 4,
  vatTotal: 5,
} as const

/** `YYYY-MM-DDTHH:mm:ssZ` — seconds precision, the format ZATCA's QR and
 * XAdES both use. `toISOString()`'s milliseconds are not part of it. */
export const zatcaTimestamp = (instant: Date): string => `${instant.toISOString().slice(0, 19)}Z`

const encoder = new TextEncoder()

/** Encodes the fields as TLV and returns the base64 payload the QR carries. */
export function qrPayload(fields: readonly QrField[]): Result<string, DomainError> {
  const chunks: Uint8Array[] = []

  for (const field of fields) {
    if (!Number.isInteger(field.tag) || field.tag < 1 || field.tag > 255) {
      return err(validationError('QR_TAG_INVALID', 'A TLV tag is one byte', { tag: field.tag }))
    }
    const bytes = typeof field.value === 'string' ? encoder.encode(field.value) : field.value
    if (bytes.length === 0 || bytes.length > 255) {
      return err(
        validationError('QR_VALUE_LENGTH', 'A TLV value is 1–255 bytes', {
          tag: field.tag,
          bytes: bytes.length,
        }),
      )
    }
    const chunk = new Uint8Array(2 + bytes.length)
    chunk[0] = field.tag
    chunk[1] = bytes.length
    chunk.set(bytes, 2)
    chunks.push(chunk)
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const payload = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    payload.set(chunk, offset)
    offset += chunk.length
  }
  return ok(Buffer.from(payload).toString('base64'))
}

/**
 * The phase 1 QR for an invoice: who charged, when, how much, how much of it
 * was VAT. Amounts are decimal strings exactly as printed on the document —
 * the QR is the document's own numbers, not a recomputation.
 */
export function phase1Qr(input: {
  sellerName: string
  sellerVatNumber: string
  /** The moment, not the day — formatted by `zatcaTimestamp`. */
  issuedAt: Date
  invoiceTotal: string
  vatTotal: string
}): Result<string, DomainError> {
  return qrPayload([
    { tag: QR_TAGS.sellerName, value: input.sellerName },
    { tag: QR_TAGS.sellerVatNumber, value: input.sellerVatNumber },
    { tag: QR_TAGS.timestamp, value: zatcaTimestamp(input.issuedAt) },
    { tag: QR_TAGS.invoiceTotal, value: input.invoiceTotal },
    { tag: QR_TAGS.vatTotal, value: input.vatTotal },
  ])
}
