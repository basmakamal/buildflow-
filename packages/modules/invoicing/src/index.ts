/**
 * Invoicing module — PUBLIC CONTRACT. docs/03 §6.1, docs/01 NFR-C4
 *
 * The invoices the tenant ISSUES, under ZATCA e-invoicing rules — as opposed
 * to the supplier invoices procurement receives. Slice 1 of the regulatory
 * track: the document's shape, money chain, hash-chain fields and phase 1 QR.
 * The UBL XML, cryptographic stamping and the clearance/reporting API follow
 * in their own slices.
 */
export {
  TaxInvoice,
  GENESIS_PREVIOUS_HASH,
  type TaxInvoiceKind,
  type TaxInvoiceStatus,
  type TaxInvoiceSnapshot,
  type TaxInvoiceLine,
  type TaxInvoiceLineInput,
  type TaxInvoiceTotals,
  type SellerIdentity,
  type BuyerIdentity,
} from './domain/tax-invoice'

export { qrPayload, phase1Qr, QR_TAGS, type QrField } from './domain/qr'
