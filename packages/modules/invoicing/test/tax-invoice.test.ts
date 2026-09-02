import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { CompanyId, TaxInvoiceId } from '@buildflow/core'
import {
  GENESIS_PREVIOUS_HASH,
  TaxInvoice,
  type TaxInvoiceLineInput,
} from '../src/domain/tax-invoice'

/**
 * The failure these tests guard is regulatory, not cosmetic: a tax invoice
 * whose arithmetic drifts by a halala, or whose chain fields are malformed,
 * is a document ZATCA clearance will refuse — discovered in production, on a
 * real sale, in front of a client.
 */

const VAT = '310123456700003'
const line = (over: Partial<TaxInvoiceLineInput> = {}): TaxInvoiceLineInput => ({
  description: 'Porcelain tile supply and install',
  quantity: '1',
  unitPrice: '100.00',
  vatRate: '15',
  ...over,
})

const draft = (over: Partial<Parameters<typeof TaxInvoice.create>[0]> = {}) =>
  TaxInvoice.create({
    id: 'inv-1' as TaxInvoiceId,
    companyId: 'co-1' as CompanyId,
    kind: 'standard',
    invoiceNumber: 'INV-2026-0001',
    uuid: '8e6ae27a-1234-4c9a-9d3e-000000000001',
    icv: 1,
    previousInvoiceHash: GENESIS_PREVIOUS_HASH,
    quotationId: null,
    seller: { name: 'شركة التشطيبات التجريبية', vatNumber: VAT },
    buyer: { name: 'Demo Client LLC', vatNumber: '399999999900003' },
    currency: 'SAR',
    lines: [line()],
    ...over,
  })

describe('the genesis hash', () => {
  it('is the base64 of the hex SHA-256 of "0", recomputed from primitives', () => {
    const recomputed = Buffer.from(createHash('sha256').update('0').digest('hex')).toString(
      'base64',
    )
    expect(GENESIS_PREVIOUS_HASH).toBe(recomputed)
  })
})

describe('identity rules', () => {
  it('accepts a valid KSA VAT registration and rejects the malformed', () => {
    expect(draft().isOk()).toBe(true)
    for (const bad of ['31012345670000', '410123456700003', '310123456700004', 'x'.repeat(15)]) {
      expect(draft({ seller: { name: 'S', vatNumber: bad } }).isErr()).toBe(true)
    }
  })

  it('requires the buyer VAT on a standard invoice, and not on a simplified one', () => {
    const standard = draft({ buyer: { name: 'Walk-in', vatNumber: null } })
    expect(standard.isErr()).toBe(true)

    const simplified = draft({ kind: 'simplified', buyer: { name: 'Walk-in', vatNumber: null } })
    expect(simplified.isOk()).toBe(true)
  })

  it('refuses any currency but SAR', () => {
    expect(draft({ currency: 'USD' }).isErr()).toBe(true)
  })

  it('refuses a non-positive counter and a missing chain hash', () => {
    expect(draft({ icv: 0 }).isErr()).toBe(true)
    expect(draft({ icv: 1.5 }).isErr()).toBe(true)
    expect(draft({ previousInvoiceHash: '  ' }).isErr()).toBe(true)
  })
})

describe('the money chain', () => {
  it('computes line nets, category VAT, and the three totals', () => {
    const invoice = draft({
      lines: [
        line({ quantity: '3', unitPrice: '100.00' }),
        line({ quantity: '1', unitPrice: '49.99' }),
      ],
    }).unwrap()

    expect(invoice.lines[0]?.netAmount).toBe('300.00')
    expect(invoice.lines[1]?.netAmount).toBe('49.99')
    expect(invoice.totals.taxExclusiveAmount).toBe('349.99')
    // 15% of 349.99 = 52.4985 → 52.50, taxed ONCE on the category sum.
    expect(invoice.totals.vatAmount).toBe('52.50')
    expect(invoice.totals.taxInclusiveAmount).toBe('402.49')
  })

  it('taxes each rate category on its sum, not per line — the EN 16931 rule', () => {
    // Three lines of 0.03 SAR at 15%: per-line VAT rounds to 0.00 each
    // (0.0045 → 0.00) and sums to 0.00; category VAT is 15% of 0.09 = 0.01.
    const invoice = draft({
      lines: [
        line({ unitPrice: '0.03' }),
        line({ unitPrice: '0.03' }),
        line({ unitPrice: '0.03' }),
      ],
    }).unwrap()

    expect(invoice.totals.taxExclusiveAmount).toBe('0.09')
    expect(invoice.totals.vatAmount).toBe('0.01')
  })

  it('keeps zero-rated lines in the total but out of the VAT', () => {
    const invoice = draft({
      lines: [
        line({ unitPrice: '100.00', vatRate: '15' }),
        line({ unitPrice: '50.00', vatRate: '0' }),
      ],
    }).unwrap()

    expect(invoice.totals.taxExclusiveAmount).toBe('150.00')
    expect(invoice.totals.vatAmount).toBe('15.00')
    expect(invoice.totals.taxInclusiveAmount).toBe('165.00')
  })

  it('refuses an empty invoice and a zero quantity', () => {
    expect(draft({ lines: [] }).isErr()).toBe(true)
    expect(draft({ lines: [line({ quantity: '0' })] }).isErr()).toBe(true)
  })
})

describe('issuing', () => {
  it('freezes the document: a second issue is refused', () => {
    const invoice = draft().unwrap()
    const now = new Date('2026-08-27T14:30:00.000Z')

    expect(invoice.status).toBe('draft')
    expect(invoice.issue(now).isOk()).toBe(true)
    expect(invoice.status).toBe('issued')
    expect(invoice.issuedAt).toEqual(now)
    expect(invoice.issue(now).isErr()).toBe(true)
  })

  it('has no QR until issued — the QR carries the issue moment', () => {
    const invoice = draft().unwrap()
    expect(invoice.qrPayload().isErr()).toBe(true)

    invoice.issue(new Date('2026-08-27T14:30:00.000Z'))
    const qr = invoice.qrPayload().unwrap()

    // Decode and spot-check the amounts are the document's own numbers.
    const raw = Buffer.from(qr, 'base64')
    const text = raw.toString('utf8')
    expect(text).toContain('310123456700003')
    expect(text).toContain('115.00')
    expect(text).toContain('15.00')
  })
})
