/**
 * Catalogue module — PUBLIC CONTRACT. docs/03 §6.1
 *
 * Materials, their categories and the unit conversions that make quantities
 * comparable. Phase 3 sprints 1–2. docs/04 §2.6
 */
export {
  Material,
  UNIT_OF_MEASURE_CODES,
  type MaterialSnapshot,
  type UomConversion,
} from './domain/material'

export {
  PrismaMaterialRepository,
  CatalogueQueries,
  type MaterialRepository,
  type CategoryRow,
  type MaterialListRow,
} from './infrastructure/prisma.repositories'

export { seedMaterialCategories } from './infrastructure/category-seeder'
