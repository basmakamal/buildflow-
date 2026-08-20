import { describe, expect, it } from 'vitest'
import type { CompanyId, PurchaseOrderId, PurchaseRequestId, UserId } from '@buildflow/core'
import { PurchaseRequest, type PurchaseRequestSnapshot } from '../src/domain/purchase-request'
import { PurchaseOrder, type PurchaseOrderSnapshot } from '../src/domain/purchase-order'

/**
 * Money leaves the company through this module, so the tests concentrate on the
 * controls: the self-approval bar, the state machines, and the over-receipt
 * ceiling that keeps the warehouse honest against the paperwork.
 */

const AT = new Date('2026-08-20T08:00:00Z')
const REQUESTER = 'user-requester' as UserId
const APPROVER = 'user-approver' as UserId

const requestSnapshot = (over: Partial<PurchaseRequestSnapshot> = {}): PurchaseRequestSnapshot => ({
  id: 'req-1' as PurchaseRequestId,
  companyId: 'co-1' as CompanyId,
  projectId: 'prj-1',
  unitId: null,
  unitStageId: null,
  requestNumber: 'PR-1',
  status: 'draft',
  requestedBy: REQUESTER,
  requestedAt: AT,
  requiredByDate: null,
  approvedBy: null,
  approvedAt: null,
  rejectionReason: null,
  totalEstimated: '0.0000',
  currency: 'SAR',
  lines: [
    {
      id: 'line-1',
      materialId: 'mat-1',
      description: null,
      quantity: '100',
      uom: 'm2',
      estimatedUnitPrice: '55.0000',
      note: null,
    },
  ],
  version: 0,
  ...over,
})

const request = (over: Partial<PurchaseRequestSnapshot> = {}) =>
  PurchaseRequest.restore(requestSnapshot(over))

const orderSnapshot = (over: Partial<PurchaseOrderSnapshot> = {}): PurchaseOrderSnapshot => ({
  id: 'po-1' as PurchaseOrderId,
  companyId: 'co-1' as CompanyId,
  requestId: 'req-1',
  supplierId: 'sup-1',
  poNumber: 'PO-1',
  status: 'issued',
  issuedAt: AT,
  expectedDeliveryDate: null,
  subtotal: '5500.0000',
  taxAmount: '825.0000',
  total: '6325.0000',
  currency: 'SAR',
  terms: null,
  lines: [
    {
      id: 'pol-1',
      materialId: 'mat-1',
      quantity: '100.0000',
      uom: 'm2',
      unitPrice: '55.0000',
      lineTotal: '5500.0000',
      receivedQuantity: '0.0000',
    },
  ],
  version: 0,
  ...over,
})

const order = (over: Partial<PurchaseOrderSnapshot> = {}) =>
  PurchaseOrder.restore(orderSnapshot(over))

describe('purchase request lifecycle', () => {
  it('walks draft → submitted → approved', () => {
    const r = request()
    expect(r.submit().isOk()).toBe(true)
    expect(r.approve(APPROVER, AT).isOk()).toBe(true)
    expect(r.status).toBe('approved')
    expect(r.approvedBy).toBe(APPROVER)
  })

  /** The control this module exists for. */
  it('refuses self-approval regardless of permissions', () => {
    const r = request({ status: 'submitted' })
    const result = r.approve(REQUESTER, AT)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('SELF_APPROVAL')
      expect(result.error.kind).toBe('forbidden')
    }
    // The refused approval must not have moved the state.
    expect(r.status).toBe('submitted')
  })

  it('requires a reason to reject, and lets a rejected request be resubmitted', () => {
    const r = request({ status: 'submitted' })
    expect(r.reject('   ').isErr()).toBe(true)

    expect(r.reject('quantities look double-counted').isOk()).toBe(true)
    expect(r.rejectionReason).toBe('quantities look double-counted')
    // Back to the drawing board, not the bin.
    expect(r.submit().isOk()).toBe(true)
  })

  it('blocks illegal jumps', () => {
    // draft → approved skips the submission that makes the approval reviewable.
    const result = request().approve(APPROVER, AT)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('INVALID_REQUEST_TRANSITION')

    expect(request({ status: 'converted' }).cancel().isErr()).toBe(true)
  })

  it('computes the estimate from priced lines and skips unpriced ones', () => {
    const r = request({
      lines: [
        ...requestSnapshot().lines,
        {
          id: 'line-2',
          materialId: 'mat-2',
          description: null,
          quantity: '10',
          uom: 'bag',
          // The engineer knows WHAT is needed before anyone knows the price.
          estimatedUnitPrice: null,
          note: null,
        },
      ],
    })
    const total = r.totalEstimated()
    expect(total.isOk()).toBe(true)
    if (total.isOk()) expect(total.value).toBe('5500.00')
  })

  it('refuses an empty request', () => {
    const { lines: _lines, ...rest } = requestSnapshot()
    const result = PurchaseRequest.create({ ...rest, lines: [] })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('REQUEST_NEEDS_LINES')
  })
})

describe('purchase order receiving', () => {
  const receive = (
    po: PurchaseOrder,
    quantity: string,
    over: Partial<{ rejectedQuantity: string; rejectionReason: string | null }> = {},
  ) =>
    po.recordReceipt([
      {
        poLineId: 'pol-1',
        quantity,
        rejectedQuantity: over.rejectedQuantity ?? '0',
        rejectionReason: over.rejectionReason ?? null,
      },
    ])

  it('settles to partially_received, then received', () => {
    const po = order()
    expect(receive(po, '40').isOk()).toBe(true)
    expect(po.status).toBe('partially_received')

    expect(receive(po, '60').isOk()).toBe(true)
    expect(po.status).toBe('received')
  })

  it('returns the pro-rated cost the ledger should book', () => {
    const result = receive(order(), '40')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      // 40 m² × 55.00 = 2200.00 — computed HERE so no caller can disagree.
      expect(result.value[0]).toMatchObject({
        materialId: 'mat-1',
        quantity: '40',
        uom: 'm2',
        totalCost: '2200.00',
      })
    }
  })

  it('tolerates 2% over-receipt and refuses more', () => {
    expect(receive(order(), '102').isOk()).toBe(true)

    const result = receive(order(), '102.0001')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RECEIPT_EXCEEDS_ORDER')
  })

  it('counts prior deliveries toward the ceiling', () => {
    const po = order()
    expect(receive(po, '90').isOk()).toBe(true)
    const result = receive(po, '13')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RECEIPT_EXCEEDS_ORDER')
  })

  it('validates every line before applying any', () => {
    const po = order({
      lines: [
        ...orderSnapshot().lines,
        {
          id: 'pol-2',
          materialId: 'mat-2',
          quantity: '10.0000',
          uom: 'bag',
          unitPrice: '20.0000',
          lineTotal: '200.0000',
          receivedQuantity: '0.0000',
        },
      ],
    })
    const result = po.recordReceipt([
      { poLineId: 'pol-1', quantity: '50', rejectedQuantity: '0', rejectionReason: null },
      { poLineId: 'pol-2', quantity: '999', rejectedQuantity: '0', rejectionReason: null },
    ])
    expect(result.isErr()).toBe(true)
    // The valid first line must NOT have been applied when the second failed.
    expect(po.lines[0]?.receivedQuantity).toBe('0.0000')
    expect(po.status).toBe('issued')
  })

  it('requires a reason when goods are rejected', () => {
    const result = receive(order(), '90', { rejectedQuantity: '10', rejectionReason: '  ' })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('REJECTION_NEEDS_REASON')
  })

  it('refuses receipts against a draft or cancelled order', () => {
    for (const status of ['draft', 'cancelled'] as const) {
      const result = receive(order({ status, issuedAt: null }), '10')
      expect(result.isErr(), status).toBe(true)
      if (result.isErr()) expect(result.error.code).toBe('ORDER_NOT_RECEIVABLE')
    }
  })

  it('refuses a receipt listing the same line twice', () => {
    const po = order()
    const result = po.recordReceipt([
      { poLineId: 'pol-1', quantity: '10', rejectedQuantity: '0', rejectionReason: null },
      { poLineId: 'pol-1', quantity: '10', rejectedQuantity: '0', rejectionReason: null },
    ])
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('RECEIPT_DUPLICATE_LINE')
  })
})

describe('purchase order money', () => {
  it('derives line totals, subtotal and total with exact arithmetic', () => {
    const created = PurchaseOrder.create({
      id: 'po-2' as PurchaseOrderId,
      companyId: 'co-1' as CompanyId,
      requestId: null,
      supplierId: 'sup-1',
      poNumber: 'PO-2',
      expectedDeliveryDate: null,
      taxAmount: '412.50',
      currency: 'SAR',
      terms: null,
      lines: [
        { id: 'l1', materialId: 'm1', quantity: '33.3300', uom: 'm2', unitPrice: '55.0000' },
        { id: 'l2', materialId: 'm2', quantity: '3', uom: 'bag', unitPrice: '306.8500' },
      ],
    })
    expect(created.isOk()).toBe(true)
    if (!created.isOk()) return

    const snapshot = created.value.toSnapshot()
    // 33.33 × 55 = 1833.15 · 3 × 306.85 = 920.55 → 2753.70 + 412.50 tax
    expect(snapshot.subtotal).toBe('2753.70')
    expect(snapshot.total).toBe('3166.20')
    expect(snapshot.lines[0]?.lineTotal).toBe('1833.15')
  })

  it('walks draft → issued and stamps the time', () => {
    const created = PurchaseOrder.create({
      id: 'po-3' as PurchaseOrderId,
      companyId: 'co-1' as CompanyId,
      requestId: null,
      supplierId: 'sup-1',
      poNumber: 'PO-3',
      expectedDeliveryDate: null,
      taxAmount: '0',
      currency: 'SAR',
      terms: null,
      lines: [{ id: 'l1', materialId: 'm1', quantity: '1', uom: 'pcs', unitPrice: '10' }],
    })
    expect(created.isOk()).toBe(true)
    if (!created.isOk()) return

    expect(created.value.issue(AT).isOk()).toBe(true)
    expect(created.value.status).toBe('issued')
    // And a second issue is an illegal jump.
    expect(created.value.issue(AT).isErr()).toBe(true)
  })
})
