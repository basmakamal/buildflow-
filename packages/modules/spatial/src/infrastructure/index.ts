/**
 * Spatial persistence — SERVER ONLY.
 *
 * A separate entry point from the package root on purpose: this side touches
 * Prisma, and the root is imported by the browser. Exporting both from one
 * barrel is what makes a module unusable from a front end, so the two never
 * meet here. docs/03 §6.1
 */
export { PrismaPlanRepository, newPlan, type PlanRepository } from './plan.repository'
export { PrismaShareRepository, type ShareRepository } from './share.repository'
