import { request, type ApiResult } from './client'

/**
 * Tax invoicing endpoints. docs/01 NFR-C4
 *
 * A thin transport layer, like the other clients: every regulated rule — the
 * VAT format, the chain, what an issued document may contain — lives on the
 * server. The UI only asks and displays.
 */

export interface TaxIdentityAddress {
  street: string | null
  buildingNumber: string | null
  district: string | null
  city: string | null
  postalCode: string | null
}

export interface TaxIdentity {
  legalName: string | null
  vatNumber: string | null
  crNumber: string | null
  address: TaxIdentityAddress
  complete: boolean
}

export interface TaxInvoiceLine {
  description: string
  quantity: string
  unitPrice: string
  vatRate: string
  netAmount?: string
}

export interface TaxInvoiceRow {
  id: string
  kind: 'standard' | 'simplified'
  status: 'draft' | 'issued'
  invoiceNumber: string
  icv: number | null
  previousInvoiceHash: string | null
  invoiceHash: string | null
  buyer: { name: string; vatNumber: string | null }
  lines: TaxInvoiceLine[]
  totals: { taxExclusiveAmount: string; vatAmount: string; taxInclusiveAmount: string }
  qr: string | null
  issuedAt: string | null
}

export interface TaxInvoiceDocument {
  xml: string
  qr: string | null
  invoiceHash: string | null
  icv: number | null
}

export const getTaxIdentity = (): Promise<ApiResult<{ data: TaxIdentity }>> =>
  request('/company/tax-identity')

export const saveTaxIdentity = (identity: {
  legalName: string
  vatNumber: string
  crNumber: string
  address: {
    street: string
    buildingNumber: string
    district: string
    city: string
    postalCode: string
  }
}): Promise<ApiResult<{ data: TaxIdentity }>> =>
  request('/company/tax-identity', { method: 'PUT', body: JSON.stringify(identity) })

export const listTaxInvoices = (unitId: string): Promise<ApiResult<{ data: TaxInvoiceRow[] }>> =>
  request(`/units/${unitId}/tax-invoices`)

export const createTaxInvoiceDraft = (
  unitId: string,
  draft: {
    kind: 'standard' | 'simplified'
    buyer: { name: string; vatNumber?: string | null }
    lines: TaxInvoiceLine[]
  },
): Promise<ApiResult<{ data: TaxInvoiceRow }>> =>
  request(`/units/${unitId}/tax-invoices`, { method: 'POST', body: JSON.stringify(draft) })

export const issueTaxInvoice = (
  invoiceId: string,
  buyerAddress?: {
    street: string
    buildingNumber: string
    district: string
    city: string
    postalCode: string
  },
): Promise<ApiResult<{ data: TaxInvoiceRow }>> =>
  request(`/tax-invoices/${invoiceId}/issue`, {
    method: 'POST',
    body: JSON.stringify(buyerAddress ? { buyerAddress } : {}),
  })

export const getTaxInvoiceDocument = (
  invoiceId: string,
): Promise<ApiResult<{ data: TaxInvoiceDocument }>> =>
  request(`/tax-invoices/${invoiceId}/document`)
