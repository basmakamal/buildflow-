import type { FastifyInstance } from 'fastify'
import type { Database } from '@buildflow/database'
import { SpendQueries, SupplierPerformanceQueries, type DateRange } from '@buildflow/procurement'
import type { Container } from '../container'
import { authenticate, requirePermission } from '../plugins/authenticate'

/**
 * Spend reports and supplier performance. Phase 3 sprint 8. docs/16 §Phase 3
 *
 * Read-only, gated behind report.run — every role that holds it also holds
 * cost.view, so the amounts these return are already visible to the caller
 * through the invoice endpoints; this is the same money, grouped usefully.
 */
export function registerReportRoutes(app: FastifyInstance, c: Container, db: Database): void {
  const spend = new SpendQueries(db)
  const performance = new SupplierPerformanceQueries(db)

  app.get<{ Querystring: { groupBy?: 'supplier' | 'unit' | 'month'; from?: string; to?: string } }>(
    '/api/v1/reports/spend',
    {
      preHandler: [authenticate(c), requirePermission('report.run')],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            groupBy: { enum: ['supplier', 'unit', 'month'] },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request) => {
      const range: DateRange = {
        ...(request.query.from ? { from: new Date(request.query.from) } : {}),
        ...(request.query.to ? { to: new Date(request.query.to) } : {}),
      }
      const groupBy = request.query.groupBy ?? 'supplier'
      const data =
        groupBy === 'unit'
          ? await spend.byUnit(range)
          : groupBy === 'month'
            ? await spend.byMonth(range)
            : await spend.bySupplier(range)
      return { groupBy, data }
    },
  )

  app.get(
    '/api/v1/reports/supplier-performance',
    { preHandler: [authenticate(c), requirePermission('report.run')] },
    async () => ({ data: await performance.report() }),
  )
}
