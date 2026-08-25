/**
 * Shared kernel.
 *
 * Pure types and value objects with zero I/O — no Prisma, no Fastify, no Redis.
 * Enforced by the `core-has-no-io` and `core-depends-on-nothing-internal` rules
 * in .dependency-cruiser.cjs, so everything here is usable in a unit test with
 * no container running. docs/02 §2
 */

export { type Result, ok, err, combine } from './result'

export {
  type DomainError,
  type ErrorKind,
  validationError,
  conflictError,
  forbiddenError,
  unauthorizedError,
  quotaError,
  invariantError,
  notFoundError,
  concurrencyError,
  MissingTenantContextError,
} from './errors'

export {
  type Branded,
  type CompanyId,
  type UserId,
  type ClientId,
  type ProjectId,
  type UnitId,
  type RoomId,
  type UnitStageId,
  type UnitWorkflowId,
  type MaterialId,
  type StockMovementId,
  type SupplierId,
  type PurchaseRequestId,
  type PurchaseOrderId,
  type GoodsReceiptId,
  type InvoiceId,
  type BudgetId,
  type RateCardId,
  type PackageId,
  type QuotationId,
  type MaterialPlanId,
  type BoqId,
  type DocumentId,
  type EventId,
  type IdGenerator,
  isUuid,
  toId,
  Uuid7Generator,
  SequentialIdGenerator,
} from './ids'

export { Money, type CurrencyCode, exponentOf } from './money'
export { Quantity, type UnitOfMeasure } from './quantity'
export { type DomainEvent, ValueObject, Entity, AggregateRoot } from './domain'
export { type Clock, SystemClock, FixedClock } from './clock'
