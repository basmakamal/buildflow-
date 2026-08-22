/**
 * Procurement module — PUBLIC CONTRACT. docs/03 §6.1
 *
 * Requests → approvals → orders → goods receipts. Phase 3 sprints 5–6.
 * docs/04 §2.9
 */
export {
  PurchaseRequest,
  type PurchaseRequestSnapshot,
  type PurchaseRequestStatus,
  type RequestLine,
} from './domain/purchase-request'

export {
  PurchaseOrder,
  type PurchaseOrderSnapshot,
  type PurchaseOrderStatus,
  type OrderLine,
  type ReceiptLineInput,
  type AcceptedReceiptLine,
} from './domain/purchase-order'

export {
  ReceiveGoodsHandler,
  type ReceiveGoodsCommand,
  type ReceiveGoodsResult,
  type OrderRepository,
  type ReceiptWriter,
  type StockPoster,
} from './application/receive-goods.handler'

export {
  PrismaPurchaseRequestRepository,
  PrismaPurchaseOrderRepository,
  PrismaReceiptWriter,
  SupplierQueries,
  ReceiptQueries,
  type SupplierRow,
  type ReceiptRow,
} from './infrastructure/prisma.repositories'

export { CatalogueStockPoster } from './infrastructure/catalogue-stock-poster'

export {
  Invoice,
  type InvoiceSnapshot,
  type InvoicePaymentStatus,
  type InvoiceLine,
  type CostAllocationEntry,
} from './domain/invoice'

export {
  PrismaInvoiceRepository,
  InvoiceQueries,
  type InvoiceListRow,
} from './infrastructure/invoice.repository'

export { Budget, type BudgetSnapshot, type BudgetBuckets } from './domain/budget'

export {
  PrismaBudgetRepository,
  BudgetQueries,
  type BudgetRevisionRow,
} from './infrastructure/budget.repository'

export {
  ProfitabilityQueries,
  type ProfitabilityReport,
  type ScopeVariance,
  type ScopeBudget,
} from './infrastructure/profitability.queries'

export {
  SpendQueries,
  SupplierPerformanceQueries,
  type CurrencyAmount,
  type DateRange,
  type SupplierSpendRow,
  type UnitSpendRow,
  type MonthSpendRow,
  type SupplierPerformanceRow,
} from './infrastructure/spend.queries'
