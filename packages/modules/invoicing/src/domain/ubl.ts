import { createHash } from 'node:crypto'
import { type DomainError, type Result, Money, err, ok, validationError } from '@buildflow/core'
import type { TaxInvoiceSnapshot } from './tax-invoice'

/**
 * The UBL 2.1 document and its hash. docs/01 NFR-C4
 *
 * THE HASH IS OVER BYTES WE EMIT, WHICH IS THE WHOLE DESIGN. ZATCA's
 * validator takes the submitted XML, removes three elements (the signing
 * extension, the ubiquitous cac:Signature block, and the QR document
 * reference — the XPath transforms in the XAdES SignedInfo name exactly
 * these), canonicalises what is left (C14N 1.1) and SHA-256s it. Libraries
 * that build XML with one serializer and hash with another end up patching
 * whitespace by hand to make the two agree.
 *
 * This builder avoids the trap by EMITTING CANONICAL FORM DIRECTLY and never
 * reparsing: no self-closing tags (C14N expands them), C14N's exact escaping
 * (& < > in text; also " in attributes; never apostrophes), LF line endings,
 * UTF-8, attributes already in canonical order. The "pure" string is then a
 * plain TEXTUAL removal of the three blocks — element tags inclusive, the
 * surrounding whitespace left exactly where it was, because that is what
 * removing element NODES from a DOM leaves behind — and the hash of that
 * string is byte-for-byte what the validator computes from our document.
 *
 * The declaration line is not hashed: canonical XML has no declaration.
 */

export interface SellerDetails {
  /** The registered legal name. */
  name: string
  vatNumber: string
  /** Commercial registration — PartyIdentification schemeID CRN. */
  crNumber: string
  address: {
    street: string
    buildingNumber: string
    /** حي — the district. ZATCA's national address has one. */
    district: string
    city: string
    postalCode: string
  }
}

export interface BuyerDetails {
  name: string
  vatNumber: string | null
  address: {
    street: string
    buildingNumber: string
    district: string
    city: string
    postalCode: string
  } | null
}

export interface UblBuildInput {
  invoice: TaxInvoiceSnapshot
  seller: SellerDetails
  buyer: BuyerDetails
  /**
   * BR-KSA-30: a standard invoice states the supply date. Defaults to the
   * issue date, which is what a progress-payment invoice usually means.
   */
  supplyDate?: string
}

/**
 * Placeholders the signing step replaces. Chosen to be impossible in real
 * content and REMOVED WITH THEIR BLOCKS before hashing, so their exact text
 * never matters to the hash.
 */
export const UBL_EXTENSIONS_PLACEHOLDER = 'SET_UBL_EXTENSIONS_STRING'
export const QR_PLACEHOLDER = 'SET_QR_CODE_DATA'

/** C14N text escaping: & < > — and CR, which canonical form encodes. */
const text = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;')

/**
 * KSA runs on UTC+3 with no daylight saving, and the regulation's clock is
 * Saudi local time. One shift, applied here and nowhere else.
 */
const riyadh = (instant: Date): { date: string; time: string } => {
  const local = new Date(instant.getTime() + 3 * 60 * 60 * 1000)
  const iso = local.toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) }
}

const money = (amount: string): string => Money.fromDecimal(amount, 'SAR').unwrap().toDecimal()

interface Category {
  rate: string
  taxable: Money
  vat: Money
}

/** The same per-rate-category arithmetic the aggregate performs. */
const categoriesOf = (invoice: TaxInvoiceSnapshot): Result<Category[], DomainError> => {
  const byRate = new Map<string, Money>()
  for (const line of invoice.lines) {
    const net = Money.fromDecimal(line.netAmount, 'SAR')
    if (net.isErr()) return err(net.error)
    byRate.set(line.vatRate, (byRate.get(line.vatRate) ?? Money.zero('SAR')).add(net.value))
  }
  const categories: Category[] = []
  for (const [rate, taxable] of byRate) {
    const vat = taxable.percentage(rate)
    if (vat.isErr()) return err(vat.error)
    categories.push({ rate, taxable, vat: vat.value })
  }
  return ok(categories)
}

const addressXml = (address: NonNullable<BuyerDetails['address']>): string =>
  `<cac:PostalAddress>
        <cbc:StreetName>${text(address.street)}</cbc:StreetName>
        <cbc:BuildingNumber>${text(address.buildingNumber)}</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>${text(address.district)}</cbc:CitySubdivisionName>
        <cbc:CityName>${text(address.city)}</cbc:CityName>
        <cbc:PostalZone>${text(address.postalCode)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>SA</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>`

/**
 * Builds the unsigned document, placeholders included.
 *
 * The KSA-2 subtype in InvoiceTypeCode's name attribute starts "01" for a
 * standard invoice and "02" for a simplified one; the five flags after it
 * (third party, nominal, export, summary, self-billed) are all features this
 * platform does not issue, so they stay zero.
 */
export function ublInvoiceXml(input: UblBuildInput): Result<string, DomainError> {
  const { invoice, seller, buyer } = input
  if (invoice.status !== 'issued' || !invoice.issuedAt) {
    return err(
      validationError('UBL_NOT_ISSUED', 'Only an issued invoice has a document', {
        status: invoice.status,
      }),
    )
  }
  if (invoice.kind === 'standard' && !buyer.address) {
    return err(
      validationError(
        'UBL_BUYER_ADDRESS_REQUIRED',
        'A standard tax invoice states the buyer address',
        {},
      ),
    )
  }

  const categoryResult = categoriesOf(invoice)
  if (categoryResult.isErr()) return err(categoryResult.error)
  const categories = categoryResult.value

  const { date: issueDate, time: issueTime } = riyadh(invoice.issuedAt)
  const supplyDate = input.supplyDate ?? issueDate
  const subtype = invoice.kind === 'standard' ? '0100000' : '0200000'

  const lines = invoice.lines
    .map((line, index) => {
      const net = money(line.netAmount)
      const lineVat = Money.fromDecimal(line.netAmount, 'SAR')
        .unwrap()
        .percentage(line.vatRate)
        .unwrap()
      const withVat = Money.fromDecimal(line.netAmount, 'SAR').unwrap().add(lineVat)
      const category = Number(line.vatRate) === 0 ? 'Z' : 'S'
      return `  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${text(line.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">${net}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="SAR">${lineVat.toDecimal()}</cbc:TaxAmount>
      <cbc:RoundingAmount currencyID="SAR">${withVat.toDecimal()}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${text(line.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${category}</cbc:ID>
        <cbc:Percent>${text(line.vatRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="SAR">${money(line.unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`
    })
    .join('\n')

  const subtotals = categories
    .map(
      (category) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="SAR">${category.taxable.toDecimal()}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="SAR">${category.vat.toDecimal()}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${Number(category.rate) === 0 ? 'Z' : 'S'}</cbc:ID>
        <cbc:Percent>${text(category.rate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`,
    )
    .join('\n')

  const buyerParty =
    invoice.kind === 'standard'
      ? `  <cac:AccountingCustomerParty>
    <cac:Party>
      ${buyer.address ? addressXml(buyer.address) : ''}
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${text(buyer.vatNumber ?? '')}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${text(buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:Delivery>
    <cbc:ActualDeliveryDate>${supplyDate}</cbc:ActualDeliveryDate>
  </cac:Delivery>`
      : `  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${text(buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>${UBL_EXTENSIONS_PLACEHOLDER}</ext:UBLExtensions>
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${text(invoice.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${text(invoice.uuid)}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${subtype}">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${invoice.icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${text(invoice.previousInvoiceHash)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${QR_PLACEHOLDER}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:Signature>
    <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
    <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="CRN">${text(seller.crNumber)}</cbc:ID>
      </cac:PartyIdentification>
      ${addressXml(seller.address)}
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${text(seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${text(seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
${buyerParty}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${money(invoice.totals.vatAmount)}</cbc:TaxAmount>
${subtotals}
  </cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SAR">${money(invoice.totals.vatAmount)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${money(invoice.totals.taxExclusiveAmount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">${money(invoice.totals.taxExclusiveAmount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${money(invoice.totals.taxInclusiveAmount)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${money(invoice.totals.taxInclusiveAmount)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>
`
  return ok(xml)
}

/** Cuts one element — open tag through close tag, nothing else — from `xml`. */
const cutElement = (xml: string, open: string, close: string): string => {
  const start = xml.indexOf(open)
  const end = xml.indexOf(close, start)
  if (start === -1 || end === -1) return xml
  return xml.slice(0, start) + xml.slice(end + close.length)
}

/**
 * What ZATCA hashes: the document minus the three excluded elements, minus
 * the declaration (canonical XML has none), whitespace residue kept — the
 * indentation that surrounded a removed element is TEXT and text survives an
 * element-node removal.
 */
export function pureInvoiceString(xml: string): string {
  let pure = xml.replace(/^<\?xml[^?]*\?>\n/, '')
  pure = cutElement(pure, '<ext:UBLExtensions>', '</ext:UBLExtensions>')
  pure = cutElement(pure, '<cac:Signature>', '</cac:Signature>')
  const qrOpen = pure.indexOf('<cbc:ID>QR</cbc:ID>')
  if (qrOpen !== -1) {
    const start = pure.lastIndexOf('<cac:AdditionalDocumentReference>', qrOpen)
    const end = pure.indexOf('</cac:AdditionalDocumentReference>', qrOpen)
    pure = pure.slice(0, start) + pure.slice(end + '</cac:AdditionalDocumentReference>'.length)
  }
  // Canonical output ends at the root's close tag — no trailing newline.
  return pure.replace(/\n$/, '')
}

/**
 * KSA-13's hash: base64 of the RAW SHA-256 digest of the pure string. (The
 * genesis constant is the one deliberate exception — base64 of the HEX
 * digest of "0" — a spec quirk, not a precedent.)
 */
export function invoiceHash(xml: string): string {
  return createHash('sha256').update(pureInvoiceString(xml), 'utf8').digest('base64')
}
