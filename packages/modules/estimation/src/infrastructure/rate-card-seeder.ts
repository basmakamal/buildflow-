import type { CompanyId, IdGenerator, UnitOfMeasure } from '@buildflow/core'
import { RateCard } from '../domain/rate-card'
import { PrismaRateCardRepository } from './rate-card.repository'
import type { Database } from '@buildflow/database'

/**
 * The regional starter card — seeded PER TENANT, the SYSTEM_ROLES pattern.
 * docs/04 §2.7 wanted `company_id NULL = regional default`; the deviation and
 * its reason live with the schema. Every tenant gets their own copy, fully
 * theirs to archive and supersede.
 *
 * The numbers are a 2026 Saudi finishing baseline: honest starting points a
 * contractor adjusts on day one, not authoritative prices — which is exactly
 * why they arrive as a normal card the tenant owns rather than a system row
 * they cannot touch. Work item codes align with the estimation catalogue's
 * trades so a generated BOQ line can find its rate.
 */

interface StarterItem {
  workItemCode: string
  descriptionEn: string
  descriptionAr: string
  uom: UnitOfMeasure
  materialRate: string
  labourRate: string
  equipmentRate: string
  productivityPerDay: string | null
}

export const STARTER_RATE_CARD_NAME = 'SA Regional Baseline 2026'

const STARTER_ITEMS: readonly StarterItem[] = [
  // ── painting ──────────────────────────────────────────────────────────────
  {
    workItemCode: 'wk_paint_walls',
    descriptionEn: 'Wall painting, 2 coats emulsion over putty and primer',
    descriptionAr: 'دهان جدران، وجهان بلاستيك فوق معجون وبرايمر',
    uom: 'm2',
    materialRate: '9.5000',
    labourRate: '8.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '45',
  },
  {
    workItemCode: 'wk_paint_ceiling',
    descriptionEn: 'Ceiling painting, 2 coats',
    descriptionAr: 'دهان أسقف، وجهان',
    uom: 'm2',
    materialRate: '9.0000',
    labourRate: '10.0000',
    equipmentRate: '0.5000',
    productivityPerDay: '35',
  },
  // ── flooring ──────────────────────────────────────────────────────────────
  {
    workItemCode: 'wk_floor_porcelain',
    descriptionEn: 'Porcelain floor tiling 60×60, adhesive fix, grouted',
    descriptionAr: 'تركيب بورسلين أرضيات ٦٠×٦٠ بالغراء مع الترويب',
    uom: 'm2',
    materialRate: '78.0000',
    labourRate: '35.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '25',
  },
  {
    workItemCode: 'wk_wall_ceramic',
    descriptionEn: 'Ceramic wall tiling, wet areas',
    descriptionAr: 'تركيب سيراميك جدران، مناطق رطبة',
    uom: 'm2',
    materialRate: '55.0000',
    labourRate: '38.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '18',
  },
  {
    workItemCode: 'wk_screed',
    descriptionEn: 'Cement-sand screed, 5 cm average',
    descriptionAr: 'لياسة أرضيات إسمنتية، متوسط ٥ سم',
    uom: 'm2',
    materialRate: '14.0000',
    labourRate: '10.0000',
    equipmentRate: '1.0000',
    productivityPerDay: '60',
  },
  {
    workItemCode: 'wk_skirting',
    descriptionEn: 'Porcelain skirting, 10 cm',
    descriptionAr: 'نعلات بورسلين، ١٠ سم',
    uom: 'm',
    materialRate: '12.0000',
    labourRate: '8.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '50',
  },
  // ── gypsum ────────────────────────────────────────────────────────────────
  {
    workItemCode: 'wk_gypsum_ceiling',
    descriptionEn: 'Gypsum board false ceiling, plain, incl. GI channels',
    descriptionAr: 'أسقف جبس بورد مستوية شامل الحديد',
    uom: 'm2',
    materialRate: '38.0000',
    labourRate: '27.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '20',
  },
  // ── plastering ────────────────────────────────────────────────────────────
  {
    workItemCode: 'wk_plaster_walls',
    descriptionEn: 'Internal wall plastering, 2 cm',
    descriptionAr: 'لياسة جدران داخلية، ٢ سم',
    uom: 'm2',
    materialRate: '11.0000',
    labourRate: '13.0000',
    equipmentRate: '0.5000',
    productivityPerDay: '40',
  },
  // ── electrical ────────────────────────────────────────────────────────────
  {
    workItemCode: 'wk_electrical_point',
    descriptionEn: 'Electrical point: conduit, wiring, accessory, terminated',
    descriptionAr: 'نقطة كهرباء: تمديد وسلك وقطعة نهائية',
    uom: 'pcs',
    materialRate: '48.0000',
    labourRate: '65.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '10',
  },
  {
    workItemCode: 'wk_lighting_point',
    descriptionEn: 'Lighting point incl. fitting installation',
    descriptionAr: 'نقطة إنارة شامل تركيب الوحدة',
    uom: 'pcs',
    materialRate: '35.0000',
    labourRate: '45.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '12',
  },
  // ── plumbing ──────────────────────────────────────────────────────────────
  {
    workItemCode: 'wk_plumbing_point',
    descriptionEn: 'Plumbing point: supply and drainage, tested',
    descriptionAr: 'نقطة سباكة: تغذية وصرف مع الاختبار',
    uom: 'pcs',
    materialRate: '95.0000',
    labourRate: '120.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '6',
  },
  {
    workItemCode: 'wk_waterproofing',
    descriptionEn: 'Cementitious waterproofing, wet areas, 2 coats',
    descriptionAr: 'عزل مائي إسمنتي، مناطق رطبة، طبقتان',
    uom: 'm2',
    materialRate: '26.0000',
    labourRate: '16.0000',
    equipmentRate: '0.0000',
    productivityPerDay: '45',
  },
]

export interface SeedResult {
  id: string
  created: boolean
}

/**
 * Idempotent: keyed on the card's unique (companyId, name) — re-seeding a
 * tenant that already has the baseline touches nothing, including a baseline
 * they have since archived. Their card, their history.
 */
export async function seedStarterRateCard(
  db: Database,
  companyId: CompanyId,
  ids: IdGenerator,
): Promise<SeedResult> {
  const existing = await db.rateCard.findFirst({
    where: { name: STARTER_RATE_CARD_NAME },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  const id = ids.next<'RateCardId'>()
  const card = RateCard.create({
    id,
    companyId,
    name: STARTER_RATE_CARD_NAME,
    countryCode: 'SA',
    city: null,
    currency: 'SAR',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: null,
    isDefault: true,
  })
  if (card.isErr()) throw new Error(`Starter card invalid: ${card.error.message}`)

  const items = card.value.replaceItems(
    STARTER_ITEMS.map((item) => ({ ...item, materialId: null })),
    () => ids.next(),
  )
  if (items.isErr()) throw new Error(`Starter items invalid: ${items.error.message}`)

  const activated = card.value.activate()
  if (activated.isErr())
    throw new Error(`Starter card refused activation: ${activated.error.message}`)

  const repository = new PrismaRateCardRepository(db)
  const created = await repository.create(card.value)
  // Lost a race with a concurrent seed: the other writer's card is the one.
  if (!created) {
    const winner = await db.rateCard.findFirst({
      where: { name: STARTER_RATE_CARD_NAME },
      select: { id: true },
    })
    return { id: winner?.id ?? String(id), created: false }
  }
  return { id: String(id), created: true }
}
