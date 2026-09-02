import { describe, expect, it } from 'vitest'
import { phase1Qr, qrPayload, QR_TAGS } from '../src/domain/qr'

/**
 * The QR is decoded by phones we do not control, so these tests assert the
 * WIRE BYTES, not our own functions round-tripping each other: a canonical
 * literal computed by hand, and a decoder written here in the test.
 */

/** Walks TLV bytes back into (tag, value-bytes) pairs. */
const decode = (base64: string): Array<{ tag: number; bytes: Uint8Array }> => {
  const raw = Buffer.from(base64, 'base64')
  const fields: Array<{ tag: number; bytes: Uint8Array }> = []
  let offset = 0
  while (offset < raw.length) {
    const tag = raw[offset] as number
    const length = raw[offset + 1] as number
    fields.push({ tag, bytes: new Uint8Array(raw.subarray(offset + 2, offset + 2 + length)) })
    offset += 2 + length
  }
  return fields
}

describe('TLV encoding', () => {
  it('produces the exact bytes, verified against a hand-computed literal', () => {
    // (tag 1, "A") (tag 2, "3") → 01 01 41 02 01 33 → base64
    const result = qrPayload([
      { tag: 1, value: 'A' },
      { tag: 2, value: '3' },
    ])
    expect(result.unwrap()).toBe('AQFBAgEz')
  })

  it('measures length in BYTES, because Arabic is not one byte per character', () => {
    // Two Arabic letters, four UTF-8 bytes. A character count would say 2 and
    // every field after this one would decode shifted.
    const fields = decode(qrPayload([{ tag: 1, value: 'شق' }]).unwrap())
    expect(fields[0]?.bytes.length).toBe(4)
    expect(new TextDecoder().decode(fields[0]?.bytes)).toBe('شق')
  })

  it('passes binary values through untouched, for the phase 2 tags', () => {
    const signature = new Uint8Array([0, 255, 128, 7])
    const fields = decode(qrPayload([{ tag: 7, value: signature }]).unwrap())
    expect(fields[0]?.tag).toBe(7)
    expect([...(fields[0]?.bytes ?? [])]).toEqual([0, 255, 128, 7])
  })

  it('refuses a value that cannot fit its one-byte length', () => {
    expect(qrPayload([{ tag: 1, value: 'x'.repeat(256) }]).isErr()).toBe(true)
  })

  it('refuses an empty value and an out-of-range tag', () => {
    expect(qrPayload([{ tag: 1, value: '' }]).isErr()).toBe(true)
    expect(qrPayload([{ tag: 0, value: 'x' }]).isErr()).toBe(true)
    expect(qrPayload([{ tag: 256, value: 'x' }]).isErr()).toBe(true)
  })
})

describe('the phase 1 invoice QR', () => {
  it('carries the five fields in specification order with the printed amounts', () => {
    const issuedAt = new Date('2026-08-27T14:30:00.000Z')
    const fields = decode(
      phase1Qr({
        sellerName: 'شركة التشطيبات التجريبية',
        sellerVatNumber: '310123456700003',
        issuedAt,
        invoiceTotal: '1150.00',
        vatTotal: '150.00',
      }).unwrap(),
    )

    const text = new TextDecoder()
    expect(fields.map((field) => field.tag)).toEqual([
      QR_TAGS.sellerName,
      QR_TAGS.sellerVatNumber,
      QR_TAGS.timestamp,
      QR_TAGS.invoiceTotal,
      QR_TAGS.vatTotal,
    ])
    expect(text.decode(fields[0]?.bytes)).toBe('شركة التشطيبات التجريبية')
    expect(text.decode(fields[1]?.bytes)).toBe('310123456700003')
    expect(text.decode(fields[2]?.bytes)).toBe('2026-08-27T14:30:00.000Z')
    expect(text.decode(fields[3]?.bytes)).toBe('1150.00')
    expect(text.decode(fields[4]?.bytes)).toBe('150.00')
  })
})
