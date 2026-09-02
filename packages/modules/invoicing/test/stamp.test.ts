import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CompanyId, TaxInvoiceId } from '@buildflow/core'
import { GENESIS_PREVIOUS_HASH, TaxInvoice } from '../src/domain/tax-invoice'
import {
  invoiceHash,
  pureInvoiceString,
  ublInvoiceXml,
  QR_PLACEHOLDER,
  UBL_EXTENSIONS_PLACEHOLDER,
  type BuyerDetails,
  type SellerDetails,
} from '../src/domain/ubl'
import { certificateInfo, signInvoice, verifySignature } from '../src/domain/stamp'

/**
 * The stamping pipeline, end to end against real cryptography. The fixtures
 * are a throwaway secp256k1 pair (see fixtures/README.md) standing in for
 * the CSID that Fatoora onboarding issues in slice 3 — same curve, same
 * machinery, no secrets.
 */

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8')

const KEY_PEM = fixture('test-ec.key')
const CERT_PEM = fixture('test-ec.crt')

const seller: SellerDetails = {
  name: 'شركة التشطيبات التجريبية',
  vatNumber: '310123456700003',
  crNumber: '1010101010',
  address: {
    street: 'طريق الملك فهد',
    buildingNumber: '8228',
    district: 'العليا',
    city: 'الرياض',
    postalCode: '12211',
  },
}

const buyer: BuyerDetails = {
  name: 'Demo Client LLC',
  vatNumber: '399999999900003',
  address: {
    street: 'King Abdullah Rd',
    buildingNumber: '4321',
    district: 'Al Malqa',
    city: 'Riyadh',
    postalCode: '13521',
  },
}

const issuedInvoice = (kind: 'standard' | 'simplified' = 'standard') => {
  const invoice = TaxInvoice.create({
    id: 'inv-1' as TaxInvoiceId,
    companyId: 'co-1' as CompanyId,
    kind,
    invoiceNumber: 'INV-2026-0001',
    uuid: '8e6ae27a-1234-4c9a-9d3e-000000000001',
    icv: 1,
    previousInvoiceHash: GENESIS_PREVIOUS_HASH,
    quotationId: null,
    seller: { name: seller.name, vatNumber: seller.vatNumber },
    buyer: { name: buyer.name, vatNumber: kind === 'standard' ? buyer.vatNumber : null },
    currency: 'SAR',
    lines: [
      {
        description: 'Porcelain tile supply & install',
        quantity: '3',
        unitPrice: '100.00',
        vatRate: '15',
      },
      { description: 'Skirting <profile>', quantity: '1', unitPrice: '49.99', vatRate: '15' },
    ],
  }).unwrap()
  invoice.issue(new Date('2026-08-27T14:30:00Z'))
  return invoice
}

const unsignedXml = (kind: 'standard' | 'simplified' = 'standard') =>
  ublInvoiceXml({
    invoice: issuedInvoice(kind).snapshot(),
    seller,
    buyer: kind === 'standard' ? buyer : { name: buyer.name, vatNumber: null, address: null },
  }).unwrap()

describe('the UBL document', () => {
  it('is only available for an issued invoice', () => {
    const draft = TaxInvoice.create({
      id: 'inv-1' as TaxInvoiceId,
      companyId: 'co-1' as CompanyId,
      kind: 'simplified',
      invoiceNumber: 'INV-1',
      uuid: 'u',
      icv: 1,
      previousInvoiceHash: GENESIS_PREVIOUS_HASH,
      quotationId: null,
      seller: { name: seller.name, vatNumber: seller.vatNumber },
      buyer: { name: 'Walk-in', vatNumber: null },
      currency: 'SAR',
      lines: [{ description: 'x', quantity: '1', unitPrice: '10.00', vatRate: '15' }],
    }).unwrap()

    expect(ublInvoiceXml({ invoice: draft.snapshot(), seller, buyer }).isErr()).toBe(true)
  })

  it('marks the kind in the KSA-2 subtype and requires the buyer address on standard', () => {
    expect(unsignedXml('standard')).toContain('<cbc:InvoiceTypeCode name="0100000">388<')
    expect(unsignedXml('simplified')).toContain('<cbc:InvoiceTypeCode name="0200000">388<')

    const missing = ublInvoiceXml({
      invoice: issuedInvoice('standard').snapshot(),
      seller,
      buyer: { ...buyer, address: null },
    })
    expect(missing.isErr()).toBe(true)
  })

  it('converts the issue moment to Saudi local time — UTC+3, no DST', () => {
    const xml = unsignedXml()
    expect(xml).toContain('<cbc:IssueDate>2026-08-27</cbc:IssueDate>')
    expect(xml).toContain('<cbc:IssueTime>17:30:00</cbc:IssueTime>')
  })

  it('carries the chain fields where ZATCA reads them', () => {
    const xml = unsignedXml()
    expect(xml).toContain('<cbc:ID>ICV</cbc:ID>\n    <cbc:UUID>1</cbc:UUID>')
    expect(xml).toContain(`>${GENESIS_PREVIOUS_HASH}</cbc:EmbeddedDocumentBinaryObject>`)
  })

  it('emits canonical form: no self-closing tags, C14N escaping, LF only', () => {
    const xml = unsignedXml()
    expect(xml).not.toMatch(/<[^>!?]*\/>/)
    expect(xml).toContain('Skirting &lt;profile&gt;')
    expect(xml).not.toContain('\r')
  })
})

describe('the pure string and the hash', () => {
  it('removes exactly the three excluded blocks and the declaration', () => {
    const xml = unsignedXml()
    const pure = pureInvoiceString(xml)

    expect(pure.startsWith('<Invoice ')).toBe(true)
    expect(pure).not.toContain('UBLExtensions')
    expect(pure).not.toContain('<cac:Signature>')
    expect(pure).not.toContain('>QR<')
    expect(pure).not.toContain(QR_PLACEHOLDER)
    // Everything else survives byte-for-byte — the PIH block among it.
    expect(pure).toContain('<cbc:ID>PIH</cbc:ID>')
    // Whitespace residue of the removed elements REMAINS, as DOM removal
    // leaves it. Blank indentation lines are the fingerprint.
    expect(pure).toContain('\n  \n')
  })

  it('hashes deterministically: base64 of the raw digest of the pure string', () => {
    const xml = unsignedXml()
    const expected = createHash('sha256').update(pureInvoiceString(xml), 'utf8').digest('base64')
    expect(invoiceHash(xml)).toBe(expected)
    expect(invoiceHash(xml)).toBe(invoiceHash(unsignedXml()))
  })

  it('is indifferent to the signature content, by construction', () => {
    // The hash must not change when the placeholders are filled — that is
    // the property that makes sign-after-hash possible at all.
    const xml = unsignedXml()
    const filled = xml
      .replace(UBL_EXTENSIONS_PLACEHOLDER, '<ext:UBLExtension>anything</ext:UBLExtension>')
      .replace(QR_PLACEHOLDER, 'QUFB')
    expect(invoiceHash(filled)).toBe(invoiceHash(xml))
  })
})

describe('the stamp', () => {
  it('signs with secp256k1 and the signature verifies against the certificate', () => {
    const invoice = issuedInvoice()
    const result = signInvoice({
      unsignedXml: unsignedXml(),
      certificatePem: CERT_PEM,
      privateKeyPem: KEY_PEM,
      signedAt: invoice.issuedAt as Date,
      sellerName: seller.name,
      sellerVatNumber: seller.vatNumber,
      issuedAt: invoice.issuedAt as Date,
      invoiceTotal: invoice.totals.taxInclusiveAmount,
      vatTotal: invoice.totals.vatAmount,
    }).unwrap()

    expect(result.signedXml).not.toContain(UBL_EXTENSIONS_PLACEHOLDER)
    expect(result.signedXml).not.toContain(QR_PLACEHOLDER)
    expect(result.signedXml).toContain(`<ds:DigestValue>${result.invoiceHash}</ds:DigestValue>`)

    const signature = /<ds:SignatureValue>([^<]+)</.exec(result.signedXml)?.[1] as string
    const cert = certificateInfo(CERT_PEM).unwrap()
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${cert.publicKey.toString('base64')}\n-----END PUBLIC KEY-----`
    expect(verifySignature(result.invoiceHash, signature, publicKeyPem)).toBe(true)
    // A different hash must NOT verify — the signature is bound to this document.
    expect(verifySignature(invoiceHash(unsignedXml('simplified')), signature, publicKeyPem)).toBe(
      false,
    )
  })

  it('embeds a phase 2 QR whose nine tags decode correctly', () => {
    const invoice = issuedInvoice()
    const result = signInvoice({
      unsignedXml: unsignedXml(),
      certificatePem: CERT_PEM,
      privateKeyPem: KEY_PEM,
      signedAt: invoice.issuedAt as Date,
      sellerName: seller.name,
      sellerVatNumber: seller.vatNumber,
      issuedAt: invoice.issuedAt as Date,
      invoiceTotal: invoice.totals.taxInclusiveAmount,
      vatTotal: invoice.totals.vatAmount,
    }).unwrap()

    const raw = Buffer.from(result.qr, 'base64')
    const tags = new Map<number, Buffer>()
    for (let offset = 0; offset < raw.length;) {
      const tag = raw[offset] as number
      const length = raw[offset + 1] as number
      tags.set(tag, Buffer.from(raw.subarray(offset + 2, offset + 2 + length)))
      offset += 2 + length
    }

    expect([...tags.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(tags.get(2)?.toString('utf8')).toBe(seller.vatNumber)
    expect(tags.get(3)?.toString('utf8')).toBe('2026-08-27T14:30:00Z')
    expect(tags.get(4)?.toString('utf8')).toBe('402.49')
    expect(tags.get(5)?.toString('utf8')).toBe('52.50')
    // 6 and 7 are the base64 STRINGS as text; 8 and 9 are raw bytes.
    expect(tags.get(6)?.toString('utf8')).toBe(result.invoiceHash)
    expect(tags.get(7)?.toString('utf8')).toMatch(/^[A-Za-z0-9+/]+=*$/)
    const cert = certificateInfo(CERT_PEM).unwrap()
    expect(tags.get(8)?.equals(cert.publicKey)).toBe(true)
    expect(tags.get(9)?.equals(cert.signature)).toBe(true)
  })

  it('refuses to stamp a document twice', () => {
    const invoice = issuedInvoice()
    const args = {
      unsignedXml: unsignedXml(),
      certificatePem: CERT_PEM,
      privateKeyPem: KEY_PEM,
      signedAt: invoice.issuedAt as Date,
      sellerName: seller.name,
      sellerVatNumber: seller.vatNumber,
      issuedAt: invoice.issuedAt as Date,
      invoiceTotal: invoice.totals.taxInclusiveAmount,
      vatTotal: invoice.totals.vatAmount,
    }
    const signed = signInvoice(args).unwrap()
    expect(signInvoice({ ...args, unsignedXml: signed.signedXml }).isErr()).toBe(true)
  })
})

describe('certificate reading', () => {
  it('extracts hash, issuer, serial, public key and signature from the PEM', () => {
    const cert = certificateInfo(CERT_PEM).unwrap()

    const expectedHash = Buffer.from(createHash('sha256').update(cert.body).digest('hex')).toString(
      'base64',
    )
    expect(cert.hash).toBe(expectedHash)
    expect(cert.issuer).toContain('CN=BuildFlow Test EGS')
    expect(cert.serialNumber).toMatch(/^\d+$/)
    // SPKI for secp256k1: uncompressed point, so the DER ends with 65 key bytes.
    expect(cert.publicKey.length).toBeGreaterThan(65)
    expect(cert.signature.length).toBeGreaterThan(60)
  })

  it('refuses a non-certificate', () => {
    expect(certificateInfo('not a pem').isErr()).toBe(true)
  })
})
